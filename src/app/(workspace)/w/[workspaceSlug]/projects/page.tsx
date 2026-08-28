import type { Metadata } from "next";

import { ProjectListScreen } from "@/features/projects/components/ProjectListScreen";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export const metadata: Metadata = {
  title: "Projects",
};

/**
 * 🔴 **Workspace 는 서버가 정한다.** URL 의 slug 는 Context 표시일 뿐이고, 소속 확인을
 * 통과한 `workspace.workspaceId` 만 조회에 들어간다(CLAUDE.md 11).
 */
export default async function WorkspaceProjectsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);

  return (
    <ProjectListScreen
      workspaceId={workspace.workspaceId}
      workspaceSlug={workspace.slug}
    />
  );
}
