"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteMemberAction } from "@/features/invitations/actions/invite-member";
import {
  inviteMemberSchema,
  type InviteMemberInput,
} from "@/features/invitations/schemas/invitation";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * 초대 폼.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다(CLAUDE.md 8).
 * 검증 규칙은 Schema 에 있다 — 여기에 `if` 로 다시 적지 않는다.
 *
 * 🔴 **발행된 링크는 이 화면에서 한 번만 보인다.** 서버에 원문이 없으므로 새로고침하면 사라진다.
 */
/** 🔴 이 폼이 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface InviteMemberLabels {
  emailLabel: string;
  submit: string;
  linkTitle: string;
  linkWarning: string;
}

export function InviteMemberForm({
  workspaceSlug,
  labels,
}: {
  workspaceSlug: string;
  labels: InviteMemberLabels;
}) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const form = useLocalizedForm<InviteMemberInput>(inviteMemberSchema, {
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
            placeholder={labels.emailLabel}
            aria-label={labels.emailLabel}
          />
          {form.formState.errors.email !== undefined && (
            <p className="text-xs text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {labels.submit}
        </Button>
      </form>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      {inviteUrl !== null && (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium">{labels.linkTitle}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {labels.linkWarning}
          </p>
          <code className="mt-2 block break-all font-mono text-[11px]">
            {inviteUrl}
          </code>
        </div>
      )}
    </div>
  );
}
