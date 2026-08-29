"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/features/invitations/actions/accept-invitation";

/**
 * 초대 수락 버튼.
 *
 * Client Component 인 이유는 하나다 — 실패 사유를 화면에 보여 줘야 한다.
 * 성공하면 Server Action 이 Workspace 로 redirect 하므로 이 화면은 사라진다.
 *
 * 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다(CLAUDE.md 19).
 */
export function AcceptInvitationForm({
  token,
  label,
}: {
  token: string;
  /** 🔴 이 버튼이 그리는 낱말 하나뿐이다(CLAUDE.md 11). */
  label: string;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onAccept() {
    setPending(true);
    setFailure(null);

    const result = await acceptInvitationAction(token);

    // 성공하면 redirect 로 흐름이 끊겨 여기에 닿지 않는다.
    if (result !== undefined && !result.ok) {
      setFailure(result.error.message);
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={onAccept} disabled={pending}>
        {label}
      </Button>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
