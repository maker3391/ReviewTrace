import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Workspace 설정 — 멤버와 초대.
 *
 * 🔴 **초대 폼은 OWNER 에게만 보인다. 그러나 그것은 편의일 뿐이다** —
 * 실제 판정은 Server Action 안의 `requireOwner` 가 한다(CLAUDE.md 11).
 */
export default async function WorkspaceSettingsPage({
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
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-base font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {workspace.name} 의 멤버와 초대
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">멤버</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableCell>{member.name ?? "이름 없음"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {member.role}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">초대</CardTitle>
            <CardDescription>
              초대받은 사람은 GitHub 로그인 뒤 이 Workspace 의 MEMBER 가 됩니다.
              자기 Personal Workspace 는 그대로 유지됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <InviteMemberForm workspaceSlug={workspace.slug} />

            {pending.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium">수락 대기</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>이메일</TableHead>
                      <TableHead className="w-32">만료</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((invitation) => (
                      <TableRow key={invitation.id}>
                        <TableCell>{invitation.email}</TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {invitation.expiresAt.toISOString().slice(0, 10)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
