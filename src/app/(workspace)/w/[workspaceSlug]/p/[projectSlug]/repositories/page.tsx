import type { Metadata } from "next";

import { RepositoryListScreen } from "@/features/repositories/components/RepositoryListScreen";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "Repositories",
};

export default async function ProjectRepositoriesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  return (
    <RepositoryListScreen
      workspaceId={workspace.workspaceId}
      project={project}
    />
  );
}
