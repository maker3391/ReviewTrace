"use client";

import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeMemberRoleAction } from "@/features/workspaces/actions/workspace-actions";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@/types/review";

/**
 * 멤버 역할 변경.
 *
 * 🔴 **화면의 판정은 편의일 뿐이다.** 「마지막 OWNER 강등 금지」·「Personal Workspace 주인
 * 불가」는 Application Service 가 Transaction 안에서 다시 판정한다 — 여기서 막는 것은
 * 눌러 보고 실패를 만나는 일을 줄이기 위한 것뿐이다.
 *
 * 실패는 예외가 아니라 `ActionResult` 로 온다 — 바뀌지 않았는데 화면만 바뀌는 일이 없게,
 * 성공했을 때만 서버가 다시 그린다.
 */
export function MemberRoleSelect({
  workspaceSlug,
  userId,
  role,
  disabled,
  disabledReason,
  label,
  roleOptions,
}: {
  workspaceSlug: string;
  userId: string;
  role: WorkspaceRole;
  disabled: boolean;
  disabledReason?: string;
  label: string;
  /** 🔴 값의 이름표. Select 의 `value` 와 Server Action 에 가는 값은 `WorkspaceRole` 그대로다. */
  roleOptions: Record<WorkspaceRole, string>;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function onChange(next: string) {
    setPending(true);
    setFailure(null);

    const result = await changeMemberRoleAction(workspaceSlug, {
      userId,
      role: next as WorkspaceRole,
    });

    setPending(false);
    if (!result.ok) {
      setFailure(result.error.message);
    }
  }

  if (disabled) {
    return (
      <span className="text-xs text-muted-foreground" title={disabledReason}>
        {roleOptions[role]}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Select value={role} onValueChange={onChange} disabled={pending}>
        <SelectTrigger className="h-7 w-28" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WORKSPACE_ROLES.map((option) => (
            <SelectItem key={option} value={option}>
              {roleOptions[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {failure !== null && (
        <p role="alert" className="text-[11px] text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
