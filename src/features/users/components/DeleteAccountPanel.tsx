"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOGIN_PATH } from "@/config/routes";
import { deleteAccountAction } from "@/features/users/actions/delete-account";

/**
 * 계정 삭제.
 *
 * 🔴 **무엇을 잃는지 «먼저» 보여 준다.** 계정 삭제는 Project 삭제보다 넓다 — 혼자 있던
 * Workspace 가 그 안의 Review Knowledge 와 함께 사라진다. 그래서 사라질 Workspace 를
 * 이름으로 늘어놓고, 남는 Workspace 도 함께 적는다. **남는다는 사실도 정보다.**
 *
 * 🔴 **막힌 이유를 「오류」로 처리하지 않는다.** 마지막 OWNER 라면 그것은 실패가 아니라
 * **사람이 먼저 해야 할 일**이다 — 어느 Workspace 인지 이름으로 적고, 무엇을 하면 되는지
 * 한 줄로 말한다. 그 상태에서는 버튼 자체가 서지 않는다.
 *
 * 🔴 **danger 색으로 화면을 칠하지 않는다**(CLAUDE.md 16). 색은 실제로 되돌릴 수 없는
 * 버튼 하나에만 쓴다 — 경고를 넓게 바르면 아무것도 경고가 아니게 된다.
 *
 * 확인 강도는 `ProjectSettingsPanel` 과 같은 방식이되 **한 단계 위**다. Project 는 이름을
 * 적게 하고, 여기서는 **로그인 신원에서 나온 값**(Personal Workspace 의 slug)을 적게 한다.
 */

/** 🔴 이 화면이 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface DeleteAccountLabels {
  intro: string;
  willDelete: string;
  willKeep: string;
  willKeepNone: string;
  slugRotated: string;
  losses: string;
  statProjects: string;
  statIssues: string;
  statPages: string;
  statKeys: string;
  blockedTitle: string;
  blockedHint: string;
  delete: string;
  cancel: string;
  dialogTitle: string;
  dialogBody: string;
  confirmPrefix: string;
  confirmSuffix: string;
}

/** 🔴 서버가 그릴 것만 넘긴다 — 내부 id 를 화면으로 내리지 않는다. */
export interface DeleteAccountWorkspace {
  slug: string;
  name: string;
  /** 남는 Workspace 인데 주소가 바뀌는가. */
  slugRotated?: boolean;
}

export function DeleteAccountPanel({
  deleted,
  preserved,
  blocked,
  losses,
  confirmValue,
  labels,
}: {
  deleted: DeleteAccountWorkspace[];
  preserved: DeleteAccountWorkspace[];
  blocked: DeleteAccountWorkspace[];
  losses: {
    projects: number;
    reviewIssues: number;
    knowledgePages: number;
    apiKeys: number;
  };
  confirmValue: string;
  labels: DeleteAccountLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const isBlocked = blocked.length > 0;

  async function onDelete() {
    const result = await deleteAccountAction();

    if (result.ok) {
      /*
        🔴 **`refresh` 를 부르지 않는다.** 이 사람은 방금 사라졌다 — 지금 화면을 다시
        그리면 소속이 없어 404 로 떨어진다. 로그인 화면으로 «바꿔» 보낸다.
      */
      router.replace(LOGIN_PATH);
    }

    // 실패 사유는 Dialog 가 제 안에 그린다.
    return result;
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-xs text-muted-foreground">{labels.intro}</p>

      {isBlocked && (
        <div className="flex flex-col gap-1 border-l-2 border-destructive/60 pl-3">
          <p className="text-xs font-medium">{labels.blockedTitle}</p>
          <ul className="flex flex-col gap-0.5">
            {blocked.map((workspace) => (
              <li key={workspace.slug} className="text-xs">
                <span className="font-medium">{workspace.name}</span>{" "}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {workspace.slug}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            {labels.blockedHint}
          </p>
        </div>
      )}

      <dl className="grid grid-cols-[7rem_1fr] gap-x-6 gap-y-2 text-xs">
        <dt className="text-muted-foreground">{labels.willDelete}</dt>
        <dd className="flex flex-col gap-0.5">
          {deleted.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            deleted.map((workspace) => (
              <span key={workspace.slug}>
                <span className="font-medium">{workspace.name}</span>{" "}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {workspace.slug}
                </span>
              </span>
            ))
          )}
        </dd>

        <dt className="text-muted-foreground">{labels.willKeep}</dt>
        <dd className="flex flex-col gap-0.5">
          {preserved.length === 0 ? (
            <span className="text-muted-foreground">{labels.willKeepNone}</span>
          ) : (
            preserved.map((workspace) => (
              <span key={workspace.slug}>
                <span className="font-medium">{workspace.name}</span>{" "}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {workspace.slug}
                </span>
                {workspace.slugRotated === true && (
                  <span className="text-[11px] text-muted-foreground">
                    {" "}
                    · {labels.slugRotated}
                  </span>
                )}
              </span>
            ))
          )}
        </dd>

        {deleted.length > 0 && (
          <>
            <dt className="text-muted-foreground">{labels.losses}</dt>
            <dd className="flex flex-wrap items-baseline gap-2.5">
              <Loss label={labels.statProjects} value={losses.projects} />
              <Divider />
              <Loss label={labels.statIssues} value={losses.reviewIssues} />
              <Divider />
              <Loss label={labels.statPages} value={losses.knowledgePages} />
              <Divider />
              <Loss label={labels.statKeys} value={losses.apiKeys} />
            </dd>
          </>
        )}
      </dl>

      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={isBlocked}
          onClick={() => setOpen(true)}
        >
          {labels.delete}
        </Button>
      </div>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setTyped("");
          }
        }}
        title={labels.dialogTitle}
        description={labels.dialogBody}
        actionLabel={labels.delete}
        cancelLabel={labels.cancel}
        /* 🔴 신원을 그대로 적기 전에는 실행되지 않는다. */
        confirmDisabled={typed !== confirmValue}
        onConfirm={onDelete}
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs" htmlFor="confirm-account-delete">
            {labels.confirmPrefix}
            <span className="font-mono font-medium">{confirmValue}</span>
            {labels.confirmSuffix}
          </label>
          <Input
            id="confirm-account-delete"
            className="font-mono"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}

function Loss({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}

function Divider() {
  return (
    <span aria-hidden className="text-border">
      ·
    </span>
  );
}
