"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteWorkspaceAction } from "@/features/workspaces/actions/workspace-actions";
import type { WorkspaceDeletionLosses } from "@/features/workspaces/server/workspace-deletion-service";

/**
 * Workspace 삭제.
 *
 * 🔴 **`ProjectSettingsPanel` 과 «같은» 위험 작업 문법이다** — 무엇을 잃는지 숫자로 먼저
 * 보여 주고, 이름을 그대로 입력받은 뒤에야 버튼이 선다. 「확인」 하나로 지워지게 두지 않는다.
 * `window.confirm` 을 쓰지 않는다 — 브라우저 모달은 자동화 도구에서 세션을 멈추게 한다.
 *
 * 🔴 **Personal Workspace 에서는 이 Component 가 «그려지지» 않는다**(설정 화면이 판단한다).
 * 지울 수 없는 버튼을 놓고 이유를 설명하는 것보다 없는 편이 정확하다.
 *
 * 🔴 **막힌 이유를 「오류」로 처리하지 않는다.** 다른 멤버가 있는 것은 실패가 아니라
 * **사람이 먼저 해야 할 일**이다 — 한 줄로 말하고 그 상태에서는 버튼이 서지 않는다.
 * `DeleteAccountPanel` 의 `blocked` 와 같은 방식이다.
 *
 * 🔴 **danger 색으로 화면을 칠하지 않는다**(CLAUDE.md 16).
 */

/** 🔴 이 화면이 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface DeleteWorkspaceLabels {
  intro: string;
  losses: string;
  statProjects: string;
  statRepositories: string;
  statReviews: string;
  statIssues: string;
  statPages: string;
  statKeys: string;
  statInvitations: string;
  statTags: string;
  blockedTitle: string;
  blockedMembers: string;
  delete: string;
  cancel: string;
  dialogTitle: string;
  dialogBody: string;
  confirmPrefix: string;
  confirmSuffix: string;
}

export function DeleteWorkspacePanel({
  workspaceSlug,
  workspaceName,
  losses,
  blockedByMembers,
  labels,
}: {
  workspaceSlug: string;
  /** 🔴 확인 입력값이다 — 사람이 화면에서 읽어 그대로 적는다. */
  workspaceName: string;
  losses: WorkspaceDeletionLosses;
  blockedByMembers: boolean;
  labels: DeleteWorkspaceLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  async function onDelete() {
    const result = await deleteWorkspaceAction(workspaceSlug);

    if (result.ok) {
      /*
        🔴 **`refresh` 를 부르지 않는다.** 이 Workspace 는 방금 사라졌다 — 지금 화면을 다시
        그리면 소속이 없어 404 로 떨어진다. 뿌리로 «바꿔» 보내면 그곳이 남아 있는
        Workspace 를 골라 준다(`app/page.tsx`).
      */
      router.replace("/");
    }

    // 실패 사유는 Dialog 가 제 안에 그린다 — 뒤에 가려진 화면으로 보내지 않는다.
    return result;
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-xs text-muted-foreground">{labels.intro}</p>

      {blockedByMembers && (
        <div className="flex flex-col gap-1 border-l-2 border-destructive/60 pl-3">
          <p className="text-xs font-medium">{labels.blockedTitle}</p>
          <p className="text-[11px] text-muted-foreground">
            {labels.blockedMembers}
          </p>
        </div>
      )}

      {/*
        🔴 **모든 수를 그린다 — 0 도 그린다.** 「무엇이 사라지는가」를 보여 주는 자리에서
        0 을 감추면 사람은 그 항목이 «없다»가 아니라 «세지 않았다»로 읽는다.
      */}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-6 gap-y-2 text-xs">
        <dt className="text-muted-foreground">{labels.losses}</dt>
        <dd className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <Loss label={labels.statProjects} value={losses.projects} />
          <Divider />
          <Loss label={labels.statRepositories} value={losses.repositories} />
          <Divider />
          <Loss label={labels.statReviews} value={losses.reviewSessions} />
          <Divider />
          <Loss label={labels.statIssues} value={losses.reviewIssues} />
          <Divider />
          <Loss label={labels.statPages} value={losses.knowledgePages} />
          <Divider />
          <Loss label={labels.statKeys} value={losses.apiKeys} />
          <Divider />
          <Loss label={labels.statInvitations} value={losses.invitations} />
          <Divider />
          <Loss label={labels.statTags} value={losses.tags} />
        </dd>
      </dl>

      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={blockedByMembers}
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
        /* 🔴 이름을 그대로 적기 전에는 실행되지 않는다. */
        confirmDisabled={typed !== workspaceName}
        onConfirm={onDelete}
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs" htmlFor="confirm-workspace-delete">
            {labels.confirmPrefix}
            <span className="font-medium">{workspaceName}</span>
            {labels.confirmSuffix}
          </label>
          <Input
            id="confirm-workspace-delete"
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
