import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { listProjectOptions } from "@/features/projects/server/project-service";
import { RepositoryDetailScreen } from "@/features/repositories/components/RepositoryDetailScreen";
import { findRepositoryDetail } from "@/features/repositories/server/repository-query";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "Repository",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectRepositoryDetailPage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    repositoryId: string;
  }>;
}) {
  const { workspaceSlug, projectSlug, repositoryId } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  if (!UUID.test(repositoryId)) {
    notFound();
  }

  const scope = {
    workspaceId: workspace.workspaceId,
    projectId: project.projectId,
  };

  const [repository, projectOptions] = await Promise.all([
    findRepositoryDetail(scope, repositoryId),
    // 🔴 옮길 수 있는 곳은 «이 Workspace 안의» Project 뿐이다. 서버가 골라 넘긴다.
    listProjectOptions(workspace.workspaceId),
  ]);

  if (repository === null) {
    notFound();
  }

  const base = `/w/${workspace.slug}/p/${project.slug}`;

  return (
    <RepositoryDetailScreen
      scope={scope}
      repository={repository}
      workspaceSlug={workspace.slug}
      projectSlug={project.slug}
      issuesPath={`${base}/issues` as Route}
      reviewsPath={`${base}/reviews` as Route}
      projectOptions={projectOptions.map((item) => ({
        slug: item.slug,
        name: item.name,
      }))}
    />
  );
}
