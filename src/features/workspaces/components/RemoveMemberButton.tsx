"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { removeMemberAction } from "@/features/workspaces/actions/workspace-actions";

/**
 * 멤버 내보내기.
 *
 * 🔴 **되돌리는 버튼이 없는 일이라 한 번 묻는다.** 묻는 자리는 공통 `ConfirmDialog`
 * 하나다 — pending 표시 · 실패 사유 · 두 번 눌림 방지가 화면마다 다시 쓰이지 않게.
 *
 * 🔴 **「삭제할 수 없다」고 적지 않는다.** 내보내기는 `workspace_members` 행 하나를
 * 지우는 것이라 계정도 기록도 남고 **다시 초대할 수 있다** — 실제로 일어나는 일만
 * 문구에 담는다(`RevokeInvitationButton` 과 같은 판단).
 *
 * 🔴 **이 버튼이 보이지 않는 것은 «편의»이지 경계가 아니다.** OWNER 여부 · 자기 자신 ·
 * Personal Workspace 주인은 Server Action 과 Application Service 가 다시 판정한다
 * (`workspace-service.ts` 의 `removeMember`).
 *
 * 🔴 **성공 뒤 목록을 브라우저에서 다시 불러오지 않는다.** Server Action 의
 * `revalidatePath` 가 이 화면을 서버에서 다시 그린다.
 */
export function RemoveMemberButton({
  workspaceSlug,
  userId,
  name,
  labels,
}: {
  workspaceSlug: string;
  userId: string;
  /** 화면에 이미 떠 있는 이름. 🔴 이메일은 받지 않는다 — 목록이 그리지 않는 값이다. */
  name: string;
  /** 🔴 이 버튼이 실제로 그리는 낱말만 받는다. */
  labels: {
    remove: string;
    cancel: string;
    confirmTitle: string;
    confirmDescription: string;
  };
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {labels.remove}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={labels.confirmTitle}
        description={
          <>
            <span className="font-medium text-foreground">{name}</span>
            <br />
            {labels.confirmDescription}
          </>
        }
        actionLabel={labels.remove}
        cancelLabel={labels.cancel}
        onConfirm={() => removeMemberAction(workspaceSlug, { userId })}
      />
    </>
  );
}
