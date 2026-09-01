"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { revokeInvitationAction } from "@/features/invitations/actions/revoke-invitation";

/**
 * 초대 취소.
 *
 * 🔴 **되돌릴 수 없는 일이라 한 번 묻는다.** 묻는 자리는 공통 `ConfirmDialog` 하나다 —
 * pending 표시 · 실패 사유 · 두 번 눌림 방지가 화면마다 다시 쓰이지 않게.
 *
 * 🔴 **「복구할 수 없다」고 적지 않는다.** 취소는 행을 지우는 것이 아니라 `revoked_at` 을
 * 찍는 것이라 「누구를 초대했다가 거뒀는가」는 그대로 남는다 — 사라지는 것은 **그 링크의
 * 자격**이고, 같은 주소로 다시 초대할 수 있다. 실제로 일어나는 일만 문구에 담는다
 * (`RevokeApiKey` 문구와 같은 판단).
 *
 * 🔴 **성공 뒤 목록을 브라우저에서 다시 불러오지 않는다.** Server Action 의
 * `revalidatePath` 가 이 화면을 서버에서 다시 그린다.
 */
export function RevokeInvitationButton({
  workspaceSlug,
  invitationId,
  email,
  labels,
}: {
  workspaceSlug: string;
  invitationId: string;
  email: string;
  /** 🔴 이 버튼이 실제로 그리는 낱말만 받는다. */
  labels: {
    revoke: string;
    cancel: string;
    confirmTitle: string;
    confirmDescription: string;
  };
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {labels.revoke}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={labels.confirmTitle}
        description={
          <>
            <span className="font-medium text-foreground">{email}</span>
            <br />
            {labels.confirmDescription}
          </>
        }
        actionLabel={labels.revoke}
        cancelLabel={labels.cancel}
        onConfirm={() => revokeInvitationAction(workspaceSlug, invitationId)}
      />
    </>
  );
}
