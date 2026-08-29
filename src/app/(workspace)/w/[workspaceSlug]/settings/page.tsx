import type { Metadata } from "next";

import { Section } from "@/components/molecules/Section";
import { AgentIntegrationPanel } from "@/features/api-keys/components/AgentIntegrationPanel";
import { ApiKeyPanel } from "@/features/api-keys/components/ApiKeyPanel";
import { listApiKeys } from "@/features/api-keys/server/api-key-service";
import { StatRow } from "@/components/molecules/StatRow";
import { listProjectOptions } from "@/features/projects/server/project-service";
import { listWorkspaceMembers } from "@/features/invitations/server/invitation-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Workspace 설정.
 *
 * 멤버·초대는 Members 화면으로 옮겼다(스펙 3) — 이 화면은 **Workspace 자신에 대한 것**만
 * 다룬다.
 *
 * 🔴 **API Key 는 OWNER 에게만 보인다.** 그 Workspace 의 Agent API 를 통째로 여는
 * 자격이라 초대와 같은 급이다 — 화면에서 감추는 것은 편의일 뿐이고, 실제 판정은
 * Server Action 안의 `requireOwner` 가 한다(CLAUDE.md 11).
 *
 * 🔴 **아직 없는 것을 있는 것처럼 그리지 않는다.** Workspace 이름·slug 변경은 만들지 않았다.
 */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);

  const isOwner = workspace.role === "OWNER";

  const [members, projects, apiKeys] = await Promise.all([
    listWorkspaceMembers(workspace.workspaceId),
    listProjectOptions(workspace.workspaceId),
    // 🔴 OWNER 가 아니면 조회하지도 않는다. 화면에서 감추는 것으로 대신하지 않는다.
    isOwner ? listApiKeys(workspace.workspaceId) : Promise.resolve([]),
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

      {isOwner && (
        <Section
          title="API Keys"
          description="Agent 가 이 Workspace 에 Review 를 보낼 때 쓰는 자격"
        >
          <ApiKeyPanel workspaceSlug={workspace.slug} apiKeys={apiKeys} />
        </Section>
      )}

      {isOwner && (
        <Section
          title="Agent Integration"
          description="Claude Code · Codex 에 이 Workspace 를 연결한다"
          variant="raised"
          bleed
        >
          {/*
            🔴 **주소만 서버가 채우고 키는 채우지 않는다.** 키가 사람 눈에 보이는 자리는
            발급 직후 1회뿐이다 — 여기에 끼워 넣으면 화면·복사기록·스크린샷으로 한 번 더
            퍼진다(CLAUDE.md 11·19).
          */}
          <AgentIntegrationPanel apiUrl={serverEnv().APP_URL} />
        </Section>
      )}
    </div>
  );
}
