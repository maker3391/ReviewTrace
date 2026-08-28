import type { Metadata } from "next";

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
import {
  listPendingInvitations,
  listWorkspaceMembers,
} from "@/features/invitations/server/invitation-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { formatDate } from "@/lib/format/date";

export const metadata: Metadata = {
  title: "Members",
};

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

  const isOwner = workspace.role === "OWNER";
  const members = await listWorkspaceMembers(workspace.workspaceId);
  const pending = isOwner
    ? await listPendingInvitations(workspace.workspaceId)
    : [];

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-lg font-semibold tracking-tight">Members</h1>

      <Section title="멤버">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead className="w-32">역할</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member, index) => (
              <TableRow key={`${member.name ?? "unknown"}-${index}`}>
                <TableCell className="font-medium">
                  {member.name ?? "이름 없음"}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {member.role}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {isOwner && (
        <>
          <Section title="초대">
            <div className="pt-3">
              <InviteMemberForm workspaceSlug={workspace.slug} />
            </div>
          </Section>

          <Section title="수락 대기">
            {pending.length === 0 ? (
              <SectionEmpty>대기 중인 초대가 없습니다.</SectionEmpty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이메일</TableHead>
                    <TableHead className="w-32 text-right">만료</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {formatDate(invitation.expiresAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
