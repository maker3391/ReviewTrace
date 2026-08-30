import type { Metadata } from "next";

import { PageContainer } from "@/components/molecules/PageContainer";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InviteMemberForm } from "@/features/invitations/components/InviteMemberForm";
import { RevokeInvitationButton } from "@/features/invitations/components/RevokeInvitationButton";
import { listPendingInvitations } from "@/features/invitations/server/invitation-service";
import { MemberRoleSelect } from "@/features/workspaces/components/MemberRoleSelect";
import { listMembers } from "@/features/workspaces/server/workspace-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { readMessages } from "@/lib/ui/appearance";
import { formatDate } from "@/lib/format/date";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.members };
}

/**
 * Workspace 멤버와 초대.
 *
 * 🔴 **초대 폼은 OWNER 에게만 보인다. 그러나 그것은 편의일 뿐이다** —
 * 실제 판정은 Server Action 안의 `requireOwner` 가 한다(CLAUDE.md 11).
 *
 * 🔴 수락 대기 목록도 OWNER 에게만 조회한다. MEMBER 에게는 「누구를 초대했는가」를
 * 보여 줄 이유가 없다.
 */
export default async function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);
  const messages = await readMessages();
  const t = messages.members;
  const roleOptions = messages.enums.role;

  const isOwner = workspace.role === "OWNER";
  const members = await listMembers(workspace.workspaceId);
  const pending = isOwner
    ? await listPendingInvitations(workspace.workspaceId)
    : [];

  return (
    <PageContainer className="gap-8">
      {/*
        🔴 **맨 위에 「멤버」를 다시 적지 않는다.** 사이드바에서 그 낱말을 눌러 들어온
        화면이다 — 제목이 없어야 첫 표가 곧바로 선다(CLAUDE.md 16).
      */}
      {/*
        🔴 제목 바로 아래 Section 에 같은 낱말을 한 번 더 적지 않는다 — 열 이름
        (이름 · 역할)만으로 무엇의 표인지 읽힌다(CLAUDE.md 16).
      */}
      <Section>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columnName}</TableHead>
              <TableHead className="w-32">{t.columnRole}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell className="font-medium">
                  {member.name ?? t.noName}
                </TableCell>
                <TableCell>
                  {/*
                    🔴 역할을 바꿀 수 있는 것은 OWNER 뿐이고, Personal Workspace 의 주인은
                    누구도 바꿀 수 없다. 여기서 막는 것은 편의일 뿐 — 서버가 다시 판정한다.
                  */}
                  <MemberRoleSelect
                    workspaceSlug={workspace.slug}
                    userId={member.userId}
                    role={member.role}
                    disabled={!isOwner || member.isPersonalOwner}
                    disabledReason={
                      member.isPersonalOwner ? t.personalOwner : undefined
                    }
                    label={t.roleLabel}
                    roleOptions={roleOptions}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {isOwner && (
        <>
          <Section title={t.invite}>
            <div className="pt-3">
              <InviteMemberForm
                workspaceSlug={workspace.slug}
                /*
                  🔴 화면에 필요한 것은 **id 뿐**이다(CLAUDE.md 11·19). 이메일·만료
                  시각까지 넘기면 RSC payload 에 한 벌 더 실린다.
                */
                liveInvitationIds={pending.map((invitation) => invitation.id)}
                labels={{
                  emailLabel: t.inviteEmailLabel,
                  submit: t.invite,
                  linkTitle: t.inviteLink,
                  linkWarning: t.inviteLinkWarning,
                }}
              />
            </div>
          </Section>

          <Section title={t.pending}>
            {pending.length === 0 ? (
              <SectionEmpty>{t.noPending}</SectionEmpty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.columnEmail}</TableHead>
                    <TableHead className="w-32 text-right">{t.columnExpires}</TableHead>
                    {/* 🔴 Action 열에는 이름표를 두지 않는다 — 버튼이 곧 이름이다. */}
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {formatDate(invitation.expiresAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {/*
                          🔴 **새어 나간 링크를 죽이는 길이다.** 여기가 없으면 만료를
                          기다리는 수밖에 없다 — 기본 유효 기간이 7일이다.
                          권한 판정은 Server Action 이 다시 한다.
                        */}
                        <RevokeInvitationButton
                          workspaceSlug={workspace.slug}
                          invitationId={invitation.id}
                          email={invitation.email}
                          labels={{
                            revoke: t.revoke,
                            cancel: t.cancel,
                            confirmTitle: t.revokeConfirmTitle,
                            confirmDescription: t.revokeConfirmDescription,
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </>
      )}
    </PageContainer>
  );
}
