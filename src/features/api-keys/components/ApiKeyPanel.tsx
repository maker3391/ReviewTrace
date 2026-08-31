"use client";

import { useState } from "react";
import { Controller } from "react-hook-form";

import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FLEX_CELL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  issueApiKeyAction,
  revokeApiKeyAction,
} from "@/features/api-keys/actions/api-key-actions";
import {
  API_KEY_EXPIRY_OPTIONS,
  issueApiKeySchema,
  type ApiKeyExpiry,
  type IssueApiKeyFormValues,
  type IssueApiKeyInput,
} from "@/features/api-keys/schemas/api-key";
import type { ApiKeySummary } from "@/features/api-keys/server/api-key-service";
import { formatDate } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * API Key 발급·폐기 화면.
 *
 * 🔴 **원문은 «발급 응답에만» 존재한다.** 서버에는 Hash 만 남으므로 이 화면을 떠나면 다시
 * 볼 수 없다(CLAUDE.md 12). 그래서 발급 결과를 Dialog 로 **한 번** 보여 주고, 닫으면 State
 * 에서도 지운다.
 *
 * 🔴 **목록은 `plainToken` 도 `keyHash` 도 받지 않는다.** 서버가 아예 넘기지 않는다 —
 * 넘기면 RSC payload 로 페이지 소스에 실려 나간다(CLAUDE.md 11).
 *
 * 🔴 **폐기는 행 삭제가 아니라 `revokedAt` 이다.** 지우면 「이 키가 언제까지 무엇을 했는가」가
 * 함께 사라진다.
 */
/** 🔴 이 화면이 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface ApiKeyLabels {
  namePlaceholder: string;
  nameLabel: string;
  issue: string;
  empty: string;
  expiresAt: string;
  /** 🔴 값(`30`·`NEVER`)은 Schema 의 것이고, 여기 오는 것은 그 값의 이름표뿐이다. */
  expiry: Record<ApiKeyExpiry, string>;
  columnName: string;
  columnPrefix: string;
  columnLastUsed: string;
  columnExpires: string;
  columnStatus: string;
  never: string;
  revoked: string;
  expired: string;
  active: string;
  revoke: string;
  cancel: string;
  revokeConfirmTitle: string;
  revokeConfirmAuthLoss: string;
  revokeConfirmRecordKept: string;
  copy: string;
  copied: string;
  close: string;
  issuedTitle: string;
  issuedWarning: string;
}

export function ApiKeyPanel({
  workspaceSlug,
  apiKeys,
  labels,
}: {
  workspaceSlug: string;
  apiKeys: readonly ApiKeySummary[];
  labels: ApiKeyLabels;
}) {
  const [issued, setIssued] = useState<{
    plainToken: string;
    name: string;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** 🔴 폐기를 묻고 있는 Key. 실제 실행은 확인을 받은 뒤에만 일어난다. */
  const [revokeTarget, setRevokeTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useLocalizedForm<
    IssueApiKeyFormValues,
    unknown,
    IssueApiKeyInput
  >(issueApiKeySchema, {
    defaultValues: { name: "", expiry: "NEVER" },
  });

  async function onIssue(values: IssueApiKeyInput) {
    setFailure(null);

    const result = await issueApiKeyAction(workspaceSlug, values);

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다(CLAUDE.md 19).
      setFailure(result.error.message);
      return;
    }

    setIssued({ plainToken: result.data.plainToken, name: result.data.name });
    form.reset();
  }

  async function onRevoke() {
    if (revokeTarget === null) {
      // 열려 있지 않으면 누를 수도 없다. 닫는 것으로 끝낸다.
      return { ok: true, data: undefined } as const;
    }

    setFailure(null);

    // 실패 사유는 Dialog 가 제 안에 그린다 — 뒤에 가려진 표로 보내지 않는다.
    // 목록은 서버가 다시 그린다 — 여기서 State 를 손보지 않는다(CLAUDE.md 8).
    return revokeApiKeyAction(workspaceSlug, revokeTarget.id);
  }

  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {/*
        🔴 **고정 폭 셋을 한 줄에 못 박아 두면 좁은 화면에서 «페이지가» 넘친다.**
        `w-64`(256) + `w-36`(144) + 발급 버튼 = 419px 이 최소인데 390px 화면의 본문은
        279px 다. 실측해 보니 만료 Select 가 잘리고 발급 버튼은 아예 화면 밖이었다 —
        표처럼 제 안에서 스크롤하는 것이 아니라 **화면 전체가** 좌우로 밀렸다.

        줄바꿈을 허용하고, 이름 칸만 좁을 때 남는 폭을 채우게 한다. `sm` 위로는
        `flex-none`·`w-64` 가 되살아나 지금 보이는 모양 그대로다.
      */}
      <form
        onSubmit={form.handleSubmit(onIssue)}
        className="flex flex-wrap items-start gap-2 pt-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
          <Input
            {...form.register("name")}
            placeholder={labels.namePlaceholder}
            aria-label={labels.nameLabel}
            className="w-full sm:w-64"
          />
          {form.formState.errors.name !== undefined && (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        {/*
          🔴 `form.watch()` 로 값을 읽지 않는다 — 매 렌더마다 새 함수를 돌려줘 메모이제이션이
          깨진다(React Compiler 가 이 Component 를 통째로 건너뛴다). Select 처럼 등록되지 않는
          입력은 `Controller` 로 잇는다 — 기존 IssueFilterBar 와 같은 방식이다.
        */}
        <Controller
          control={form.control}
          name="expiry"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-36" aria-label={labels.expiresAt}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_KEY_EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.expiry[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />

        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {labels.issue}
        </Button>
      </form>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      {apiKeys.length === 0 ? (
        <p className="py-6 text-xs text-muted-foreground">{labels.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            {/*
              🔴 **이름은 「남는 폭을 가져가는 칸」이 아니다.** 한 Key 의 사실들
              (이름 · Prefix · 마지막 사용 · 만료 · 상태)은 **한 줄로 묶여 읽혀야** 한다 —
              이름에 `FLEX_CELL` 을 걸면 그 칸이 남는 폭을 전부 먹어 나머지가 화면 오른쪽
              끝으로 밀리고, 한 행이 좌우로 찢어져 보인다. 실제로 그렇게 보였다.

              그래서 metadata 열은 **폭을 적지 않아 제 내용만큼만** 서고(`TableCell` 이
              `whitespace-nowrap` 이라 값이 잘리지 않는다), 남는 폭은 **행 끝의 action 칸**이
              가져간다 — `FLEX_CELL` 이 원래 그 용도다(`components/ui/table.tsx`).
              이름만 상한을 둬 긴 값이 표를 밀지 못하게 한다.
            */}
            <TableRow>
              <TableHead className="max-w-[14rem]">{labels.columnName}</TableHead>
              <TableHead>{labels.columnPrefix}</TableHead>
              <TableHead>{labels.columnLastUsed}</TableHead>
              <TableHead>{labels.columnExpires}</TableHead>
              <TableHead>{labels.columnStatus}</TableHead>
              <TableHead className={cn(FLEX_CELL, "text-right")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.map((key) => {
              const expired =
                key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime();
              const dead = key.revokedAt !== null || expired;

              return (
                <TableRow key={key.id}>
                  <TableCell className="max-w-[14rem] overflow-hidden">
                    {/*
                      🔴 이름은 사용자가 적는 자유 텍스트라 얼마든지 길어진다. **긴 값만**
                      제 칸 안에서 잘리고 전문은 `title` 로 확인한다 — 짧은 이름은 그대로
                      제 폭만 차지해 옆 칸과 붙어 선다. 새 Tooltip 을 만들지 않는다.
                    */}
                    <span className="block truncate font-medium" title={key.name}>
                      {key.name}
                    </span>
                  </TableCell>
                  {/*
                    🔴 **masking 하지 않고 eye icon 도 두지 않는다.** `keyPrefix` 는 원문의
                    앞 8자뿐이라(`lib/api/api-key-token.ts`) 남은 35자·208bit 가 없으면
                    토큰이 되지 못한다 — 가릴 것이 아니라 **어느 키인지 알아보는 표시**다.
                    반대로 눈 아이콘을 두면 「전체 Key 를 다시 볼 수 있다」는 뜻이 되는데,
                    원문은 DB 에 없어 애초에 불가능하다(CLAUDE.md 12).
                    🔴 **저장된 11자를 자르지 않는다** — 그것이 이 열의 유일한 쓸모다.
                  */}
                  <TableCell className="font-mono text-[13px] text-foreground">
                    {key.keyPrefix}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {key.lastUsedAt === null ? "—" : formatDate(key.lastUsedAt)}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {key.expiresAt === null ? labels.never : formatDate(key.expiresAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {key.revokedAt !== null
                      ? labels.revoked
                      : expired
                        ? labels.expired
                        : labels.active}
                  </TableCell>
                  {/*
                    🔴 **남는 폭은 여기가 가져간다.** 그래야 앞의 metadata 가 왼쪽에 묶여
                    한 줄로 읽히고, 행 끝에는 action 하나만 선다.
                  */}
                  <TableCell className={cn(FLEX_CELL, "text-right")}>
                    {!dead && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setRevokeTarget({ id: key.id, name: key.name })
                        }
                      >
                        {labels.revoke}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/*
        🔴 **폐기는 되묻는다.** 자격을 없애는 일이라 눌린 자리에서 곧바로 실행하지 않는다 —
        그 키를 쓰던 Agent 는 다음 요청부터 `401` 을 받는다(CLAUDE.md 12).

        🔴 **「복구할 수 없다」고 말하지 않는다.** 행은 남고(`revokedAt`) 그 키가 무엇을
        했는지도 남는다 — 사라지는 것은 인증 자격뿐이다. 문구는 `messages` 가 갖는다.
      */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
          }
        }}
        title={labels.revokeConfirmTitle}
        /* 🔴 대상 이름은 사전이 아니라 실제 행의 값이다 — 무엇을 폐기하는지가 여기서 갈린다. */
        description={
          <span className="font-medium text-foreground">
            {revokeTarget?.name}
          </span>
        }
        /*
          🔴 **안내를 이름 뒤에 이어 붙이지 않는다.** `consequence` 는 대상과 성격이 다른
          줄을 여백 한 단계 아래로 내리는 자리다(ConfirmDialog) — 이름 · 안내가 눈으로
          갈린다. 두 줄은 «한» Description 안에 둔다: Radix 의 `aria-describedby` 가
          가리키는 요소는 하나뿐이라, 밖으로 빼면 읽어 주는 도구가 그 줄을 읽지 않는다.
        */
        consequence={
          <>
            {labels.revokeConfirmAuthLoss}
            <br />
            {labels.revokeConfirmRecordKept}
          </>
        }
        actionLabel={labels.revoke}
        cancelLabel={labels.cancel}
        onConfirm={onRevoke}
      />

      <Dialog
        open={issued !== null}
        onOpenChange={(open) => {
          if (!open) {
            // 🔴 닫으면 State 에서도 지운다. 원문을 브라우저 메모리에 남겨 둘 이유가 없다.
            setIssued(null);
            setCopied(false);
          }
        }}
      >
        {/*
          🔴 **폭은 토큰이 정한다.** 토큰은 `ci_` + base64url 43자 = **46자**이고
          (`lib/api/api-key-token.ts`) 이 자리가 그것을 사람이 보는 **유일한** 화면이다 —
          기본 Dialog 폭(`sm:max-w-sm`)에서는 46자가 여러 줄로 접혀 어디까지가 키인지
          읽히지 않는다. 좁은 화면에서는 접지 않고 가로로 흐르게 둔다.
        */}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{labels.issuedTitle}</DialogTitle>
            <DialogDescription>
              {/*
                🔴 **「서버에 저장되지 않는다」는 구현 설명이다.** 사용자가 알아야 할 것은
                「다시 못 본다 → 지금 복사해 둬라」뿐이다.
              */}
              {labels.issuedWarning}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            {issued !== null && (
              <p className="text-xs text-muted-foreground">{issued.name}</p>
            )}
            {/*
              🔴 **키를 자르지 않는다.** `select-all` 로 한 번 눌러 전체가 잡히게 하고,
              좁은 화면에서는 줄바꿈 대신 가로 스크롤로 흐른다.
            */}
            <code className="block overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2.5 font-mono text-[13px] whitespace-nowrap select-all">
              {issued?.plainToken}
            </code>
          </div>

          {/*
            🔴 **여기서 할 일은 「복사」다.** 닫기는 그 다음이라 결이 약해야 한다 —
            Footer 가 `sm:flex-row` 라 DOM 뒤쪽이 오른쪽에 선다.
          */}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setIssued(null)}>
              {labels.close}
            </Button>
            <Button
              size="sm"
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
    </div>
  );
}
