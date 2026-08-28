import type { Metadata } from "next";

import { Section } from "@/components/molecules/Section";
import { StatRow } from "@/components/molecules/StatRow";
import { listProjectOptions } from "@/features/projects/server/project-service";
import { listWorkspaceMembers } from "@/features/invitations/server/invitation-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Workspace 설정.
 *
 * 멤버·초대는 Members 화면으로 옮겼다(스펙 3) — 이 화면은 **Workspace 자신에 대한 것**만
 * 다룬다.
 *
 * 🔴 **아직 없는 것을 있는 것처럼 그리지 않는다.** Workspace 이름·slug 변경, API Key 발급
 * 화면은 만들지 않았다 — 눌러서 아무 일도 일어나지 않는 버튼을 두지 않는다.
 * API Key 는 지금도 Application Service(`api-key-service.ts`)로만 만들 수 있다.
 */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);

  const [members, projects] = await Promise.all([
    listWorkspaceMembers(workspace.workspaceId),
    listProjectOptions(workspace.workspaceId),
  ]);

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      <Section title="Workspace">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-6 gap-y-2 pt-3 text-sm">
          <dt className="text-xs text-muted-foreground">이름</dt>
          <dd className="font-medium">{workspace.name}</dd>

          <dt className="text-xs text-muted-foreground">slug</dt>
          <dd className="font-mono text-xs">{workspace.slug}</dd>

          <dt className="text-xs text-muted-foreground">종류</dt>
          <dd className="text-xs">
            {workspace.isPersonal ? "Personal Workspace" : "Workspace"}
          </dd>

          <dt className="text-xs text-muted-foreground">내 역할</dt>
          <dd className="font-mono text-xs">{workspace.role}</dd>
        </dl>
      </Section>

      <Section title="규모">
        <div className="pt-4">
          <StatRow
            stats={[
              { label: "Projects", value: projects.length },
              { label: "Members", value: members.length },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}
