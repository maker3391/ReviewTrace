import type { Metadata } from "next";

import { WorkspaceDashboardScreen } from "@/features/dashboard/components/WorkspaceDashboardScreen";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.dashboard };
}

/**
 * Workspace Dashboard.
 *
 * `app/` 은 얇게 유지한다 — 화면 조립은 Feature 가 한다.
 *
 * 🔴 **Layout 이 막았어도 여기서 한 번 더 확인한다.** 화면 판정은 편의일 뿐이고, 데이터에
 * 가장 가까운 자리가 경계다. `requireWorkspace` 는 요청 안에서 캐시된다.
 */
export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);

  return (
    <WorkspaceDashboardScreen
      workspaceId={workspace.workspaceId}
      workspaceSlug={workspace.slug}
      workspaceName={workspace.name}
    />
  );
}
