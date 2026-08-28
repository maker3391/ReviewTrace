"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteMemberAction } from "@/features/invitations/actions/invite-member";
import {
  inviteMemberSchema,
  type InviteMemberInput,
} from "@/features/invitations/schemas/invitation";

/**
 * 초대 폼.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다(CLAUDE.md 8).
 * 검증 규칙은 Schema 에 있다 — 여기에 `if` 로 다시 적지 않는다.
 *
 * 🔴 **발행된 링크는 이 화면에서 한 번만 보인다.** 서버에 원문이 없으므로 새로고침하면 사라진다.
 */
export function InviteMemberForm({ workspaceSlug }: { workspaceSlug: string }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: InviteMemberInput) {
    setFailure(null);
    setInviteUrl(null);

    const formData = new FormData();
    formData.set("email", values.email);

    const result = await inviteMemberAction(workspaceSlug, formData);

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다(CLAUDE.md 19).
      setFailure(result.error.message);
      return;
    }

    setInviteUrl(new URL(result.data.inviteUrl, window.location.origin).toString());
    form.reset();
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex items-start gap-2"
      >
        <div className="flex flex-1 flex-col gap-1">
          <Input
            {...form.register("email")}
            type="email"
            placeholder="초대할 이메일"
            aria-label="초대할 이메일"
          />
          {form.formState.errors.email !== undefined && (
            <p className="text-xs text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          초대
        </Button>
      </form>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      {inviteUrl !== null && (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium">초대 링크</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            지금 복사하세요. 이 링크는 다시 볼 수 없습니다.
          </p>
          <code className="mt-2 block break-all font-mono text-[11px]">
            {inviteUrl}
          </code>
        </div>
      )}
    </div>
  );
}
