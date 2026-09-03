"use client";

import { Check, Minus } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/atoms/Timestamp";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { MetaDot } from "@/components/molecules/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  issueAgentCredentialAction,
  revokeAgentCredentialAction,
  setAgentWorkspaceGrantAction,
} from "@/features/agent-credentials/actions/agent-credential-actions";
import type {
  AgentCredentialSummary,
  AgentWorkspaceGrantOption,
} from "@/features/agent-credentials/server/agent-credential-service";
import {
  partitionAgentCredentials,
  type AgentCredentialView,
} from "@/features/agent-credentials/utils/agent-credential-view";
import { formatDate } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import type { AgentReviewLanguage } from "@/types/agent";

/**
 * Agent 연결 화면.
 *
 * 🔴 **내부 인증 모델을 낱말로 노출하지 않는다.** Principal · Credential · Grant 는
 * 서버가 쓰는 이름이다 — 사용자가 알아야 하는 것은 「이 연결을 어디에서 쓸 수 있는가」와
 * 「아직 살아 있는가」뿐이다. 그렇다고 **의미를 바꾸지도 않는다**: Workspace 접근은
 * 실제로 Principal 단위라, 연결마다 따로 정할 수 있는 것처럼 그리지 않는다
 * (`agent-credential-view.ts`).
 *
 * 🔴 **화면은 «지금 쓸 수 있는 연결»만 그린다.** 폐기·만료된 연결은 접어 두지도 않는다 —
 * 관리 화면에서 사용자가 고르는 대상은 살아 있는 것뿐이고, 지나간 연결을 열어 볼
 * 자리를 두면 그것도 아직 쓸 수 있는 것처럼 읽힌다. 🔴 **그렇다고 지우는 것이 아니다**:
 * 폐기 행은 `revokedAt` 과 함께 Database 에 그대로 남고(`revokeUserAgentCredential`),
 * 무엇을 그릴지의 판정은 여전히 `partitionAgentCredentials` 의 `active` 다.
 *
 * 🔴 **순서가 곧 사용 흐름이다** — 새 연결 → 사용 중인 연결 → Workspace 접근.
 * 목록을 맨 위에 두면 처음 오는 사람이 「없습니다」를 먼저 읽고 무엇을 해야 할지
 * 모른 채 멈춘다. 만들고, 만든 것을 확인하고, 어디에서 쓸지 정하는 차례로 둔다.
 *
 * 🔴 **설명 문장을 두지 않는다.** 이 화면이 갖는 것은 머리글 · 입력 이름표 · 현재 상태 ·
 * 할 수 있는 일 넷뿐이다 — 그 밖의 안내는 같은 것을 두 번 말한다(CLAUDE.md 16).
 */
export interface AgentCredentialLabels {
  issue: string;
  name: string;
  readOnly: string;
  readWrite: string;
  never: string;
  days30: string;
  days90: string;
  days365: string;
  credentials: string;
  noCredentials: string;
  prefix: string;
  capability: string;
  reviewLanguage: string;
  korean: string;
  english: string;
  lastUsed: string;
  expires: string;
  status: string;
  active: string;
  revoke: string;
  cancel: string;
  revokeConfirmTitle: string;
  revokeConfirmConsequence: string;
  workspaceAccess: string;
  granted: string;
  notGranted: string;
  grant: string;
  revokeGrant: string;
  ownerRequired: string;
  issuedTitle: string;
  issuedWarning: string;
  copy: string;
  copied: string;
  close: string;
  activeConnections: string;
  neverUsed: string;
}

export function AgentCredentialPanel({
  workspaceSlug,
  currentUserId,
  credentials,
  grants,
  defaultReviewLanguage,
  labels,
}: {
  workspaceSlug: string;
  currentUserId: string;
  credentials: readonly AgentCredentialSummary[];
  grants: readonly AgentWorkspaceGrantOption[];
  defaultReviewLanguage: AgentReviewLanguage;
  labels: AgentCredentialLabels;
}) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<"30" | "90" | "365" | "NEVER">("NEVER");
  const [capability, setCapability] = useState<"READ_ONLY" | "READ_WRITE">(
    "READ_WRITE",
  );
  const [reviewLanguage, setReviewLanguage] = useState<AgentReviewLanguage>(
    credentials[0]?.reviewLanguage ?? defaultReviewLanguage,
  );
  const [issued, setIssued] = useState<{
    name: string;
    plainToken: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const now = new Date();

  /*
 🔴 **`active` 만 그린다.** 폐기·만료 판정은 여전히 이 순수 함수 하나가 갖는다
 (`agent-credential-view.ts`) — 화면에서 접는 자리를 없앤 것이지 판정을 없앤 것이
 아니다. 폐기하면 Server Action 이 `revalidatePath` 로 이 화면을 다시 그리고,
 그때 그 행은 `retired` 로 갈려 목록에서 곧바로 사라진다.
 */
  const { active } = partitionAgentCredentials(credentials, now);

  function issue() {
    startTransition(async () => {
      setFailure(null);
      const result = await issueAgentCredentialAction(workspaceSlug, {
        name,
        expiry,
        capability,
        reviewLanguage,
      });
      if (!result.ok) return setFailure(result.error.message);
      setIssued(result.data);
      setName("");
    });
  }

  async function revoke() {
    if (revokeTarget === null) {
      return { ok: true, data: undefined } as const;
    }
    return revokeAgentCredentialAction(workspaceSlug, revokeTarget.id);
  }

  function setGrant(option: AgentWorkspaceGrantOption) {
    startTransition(async () => {
      setFailure(null);
      const result = await setAgentWorkspaceGrantAction(
        option.slug,
        currentUserId,
        !option.granted,
      );
      if (!result.ok) setFailure(result.error.message);
    });
  }

  /** 🔴 여기 오는 것은 `active` 뿐이다 — 상태 낱말을 덧붙일 행이 없다. */
  function connectionRow(credential: AgentCredentialView) {
    return (
      <li
        key={credential.id}
        className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium wrap-anywhere">
            {credential.name}
          </p>
          {/*
 🔴 **한 줄에 사실만 늘어놓는다.** 열을 여덟 개 두면 이름이 묻히고 좁은 화면에서
 표가 넘친다 — 사용자가 먼저 찾는 것은 「어느 연결인가」다(CLAUDE.md 16).
 */}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span>
              {credential.capabilityScopes.includes("WRITE")
                ? labels.readWrite
                : labels.readOnly}
            </span>
            <MetaDot />
            <span>
              {credential.reviewLanguage === "ko"
                ? labels.korean
                : labels.english}
            </span>
            <MetaDot />
            <span className="font-mono">{credential.keyPrefix}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span>
              {labels.lastUsed}{" "}
              {credential.lastUsedAt === null ? (
                labels.neverUsed
              ) : (
                <Timestamp value={credential.lastUsedAt} variant="compact" />
              )}
            </span>
            <MetaDot />
            <span>
              {labels.expires}{" "}
              {credential.expiresAt === null
                ? labels.never
                : formatDate(credential.expiresAt)}
            </span>
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            setRevokeTarget({ id: credential.id, name: credential.name })
          }
        >
          {labels.revoke}
        </Button>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-3">
      {/*
 🔴 **여기에 heading 을 두지 않는다.** Section 제목이 이미 「Agent 연결」이고 아래
 버튼이 「Agent 연결 생성」이라, 그 사이에 「새 연결」을 끼우면 같은 말이 세 번 선다.
 field label(이름·권한·리뷰 언어·만료)과 action 만으로 무엇을 만드는 자리인지 읽힌다.
 */}
      <div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_auto_auto_auto_auto] xl:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
            {labels.name}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full"
              maxLength={100}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {labels.capability}
            <select
              value={capability}
              onChange={(event) =>
                setCapability(event.target.value as "READ_ONLY" | "READ_WRITE")
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="READ_WRITE">{labels.readWrite}</option>
              <option value="READ_ONLY">{labels.readOnly}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {labels.reviewLanguage}
            <select
              value={reviewLanguage}
              onChange={(event) =>
                setReviewLanguage(event.target.value as AgentReviewLanguage)
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="ko">{labels.korean}</option>
              <option value="en">{labels.english}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {labels.expires}
            <select
              value={expiry}
              onChange={(event) => setExpiry(event.target.value as typeof expiry)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="NEVER">{labels.never}</option>
              <option value="30">{labels.days30}</option>
              <option value="90">{labels.days90}</option>
              <option value="365">{labels.days365}</option>
            </select>
          </label>
          <Button
            size="sm"
            className="sm:col-span-2 xl:col-span-1"
            disabled={pending || name.trim() === ""}
            onClick={issue}
          >
            {labels.issue}
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium">{labels.activeConnections}</h3>
        {active.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">
            {labels.noCredentials}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border bg-card">
            {active.map(connectionRow)}
          </ul>
        )}
      </div>

      {/*
 🔴 **동작은 그대로다** — 접근 권한은 연결마다가 아니라 «사람» 단위다
 (`agent_workspace_grants` 의 PK 가 `(principal_id, workspace_id)` 이고 살아 있는
 USER_AGENT Principal 은 사람마다 하나다). 여기서 끄면 그 사람의 모든 연결에서
 함께 꺼진다. 그 사실을 문장으로 적지 않는 것이지 동작을 바꾼 것이 아니다.
 */}
      <div>
        <h3 className="mb-2 text-xs font-medium">{labels.workspaceAccess}</h3>
        <ul className="divide-y divide-border/60 rounded-lg border bg-card">
          {grants.map((option) => (
            <li
              key={option.workspaceId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                {/*
 🔴 **색으로만 상태를 말하지 않는다.** 아이콘 모양(체크·빗금)과 **눈에 보이는
 낱말**이 함께 있어야 색을 구분하지 못해도 읽힌다 — 그래서 예전의 `sr-only`
 상태 문구를 화면 위로 올렸다. 색은 그 위에 얹는 보조 신호일 뿐이다.
 */}
                {option.granted ? (
                  <Check
                    aria-hidden
                    className="size-3.5 shrink-0 text-primary"
                  />
                ) : (
                  <Minus
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0">
                  <span className="text-sm font-medium">{option.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {option.slug}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span
                  className={cn(
                    "text-[11px]",
                    option.granted
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {option.granted ? labels.granted : labels.notGranted}
                </span>
                {/*
 🔴 **누를 수 있는 자리로 보여야 한다.** `ghost` 는 글자와 구분되지 않아 이것이
 버튼인지 상태 표시인지 알 수 없었다 — 테두리가 있는 `outline` 로 올린다.
 🔴 **`default`(filled primary)로 올리지는 않는다.** 이 화면의 Primary Action 은
 위의 「Agent 연결 생성」 하나이고, Workspace 마다 filled 버튼이 늘어서면
 그것과 경쟁한다. 새 색·임의 값을 만들지 않고 기존 variant 만 쓴다.
 */}
                {option.role === "OWNER" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setGrant(option)}
                  >
                    {option.granted ? labels.revokeGrant : labels.grant}
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {labels.ownerRequired}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      <Dialog
        open={issued !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIssued(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{labels.issuedTitle}</DialogTitle>
            <DialogDescription>{labels.issuedWarning}</DialogDescription>
          </DialogHeader>
          <code className="block overflow-x-auto rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-[13px] whitespace-nowrap select-all">
            {issued?.plainToken}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssued(null)}>
              {labels.close}
            </Button>
            <Button
              onClick={() => {
                if (issued !== null) {
                  void navigator.clipboard.writeText(issued.plainToken);
                  setCopied(true);
                }
              }}
            >
              {copied ? labels.copied : labels.copy}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title={labels.revokeConfirmTitle}
        description={
          <span className="font-medium text-foreground">
            {revokeTarget?.name}
          </span>
        }
        consequence={labels.revokeConfirmConsequence}
        actionLabel={labels.revoke}
        cancelLabel={labels.cancel}
        onConfirm={revoke}
      />
    </div>
  );
}
