"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteMemberAction } from "@/features/invitations/actions/invite-member";
import {
  inviteMemberSchema,
  type InviteMemberInput,
} from "@/features/invitations/schemas/invitation";
import {
  visibleInviteUrl,
  type IssuedInvite,
} from "@/features/invitations/utils/invite-link";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * 초대 폼.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다.
 * 검증 규칙은 Schema 에 있다 — 여기에 `if` 로 다시 적지 않는다.
 *
 * 🔴 **발행된 링크는 이 화면에서 한 번만 보인다.** 서버에 원문이 없으므로 새로고침하면 사라진다.
 *
 * ## 🔴 링크는 «살아 있는 동안만» 보인다
 *
 * 링크는 Client state 라 **`revalidatePath` 가 지우지 못한다.** 바로 아래 목록에서 그
 * 초대를 취소하면 서버는 목록을 다시 그리는데 이 패널만 남아, **이미 죽은 Token 을
 * 「지금 복사하세요」로 권했다.**
 *
 * 그래서 서버가 다시 그리는 **살아 있는 초대 id 목록**을 받아, 방금 낸 초대가 거기
 * 없으면 스스로 지운다. 🔴 **Token 을 비교하지 않는다** — 죽은 Token 을 판정에 쓰려고
 * 화면에 한 벌 더 두는 꼴이 된다.
 */
/** 🔴 이 폼이 실제로 그리는 낱말만 받는다. */
export interface InviteMemberLabels {
  emailLabel: string;
  submit: string;
  linkTitle: string;
  linkWarning: string;
}

export function InviteMemberForm({
  workspaceSlug,
  labels,
  liveInvitationIds,
}: {
  workspaceSlug: string;
  labels: InviteMemberLabels;
  /** 지금 살아 있는(수락도 취소도 되지 않은) 초대의 id. 서버가 매번 다시 넘긴다. */
  liveInvitationIds: readonly string[];
}) {
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * 🔴 **정본은 서버가 그린 목록이다.** 여기 남은 것이 아직 유효한지는 우리가 기억하는
   * 것이 아니라 그 목록이 답한다 — 취소는 다른 컴포넌트에서 일어나고, 그 뒤 이 화면은
   * 새 `liveInvitationIds` 로 다시 그려진다.
   */
  const inviteUrl = visibleInviteUrl(issued, liveInvitationIds);

  const form = useLocalizedForm<InviteMemberInput>(inviteMemberSchema, {
    defaultValues: { email: "" },
  });

  async function onSubmit(values: InviteMemberInput) {
    setFailure(null);
    setIssued(null);

    const formData = new FormData();
    formData.set("email", values.email);

    const result = await inviteMemberAction(workspaceSlug, formData);

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다.
      setFailure(result.error.message);
      return;
    }

    setIssued({
      id: result.data.invitationId,
      url: new URL(result.data.inviteUrl, window.location.origin).toString(),
    });
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
