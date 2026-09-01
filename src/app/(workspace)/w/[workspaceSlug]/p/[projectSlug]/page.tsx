import type { Metadata } from "next";

import { ProjectDashboardScreen } from "@/features/dashboard/components/ProjectDashboardScreen";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.project };
}

/**
 * Project Dashboard.
 *
 * 🔴 **Tenant 판정은 `requireProject` 하나가 한다**(스펙 3).
 * ```
 * Session -> User -> Workspace 소속 -> 그 Workspace 안의 Project -> Resource
 * ```
 * 주소의 `projectSlug` 는 Context 표시일 뿐 권한 근거가 아니다 — 남의 Project slug 를
 * 적으면 404 다(403 이 아니다).
 */
export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(
    workspaceSlug,
    projectSlug,
  );

  return (
    <ProjectDashboardScreen
      workspaceId={workspace.workspaceId}
      workspaceSlug={workspace.slug}
      project={project}
    />
  );
}
