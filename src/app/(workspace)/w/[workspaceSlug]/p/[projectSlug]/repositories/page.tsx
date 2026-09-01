import type { Metadata } from "next";
import type { Route } from "next";

import { RepositoryListScreen } from "@/features/repositories/components/RepositoryListScreen";
import { requireProject } from "@/lib/auth/require-project";
import type { RawSearchParams } from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.repositories };
}

export default async function ProjectRepositoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(
    workspaceSlug,
    projectSlug,
  );

  return (
    <RepositoryListScreen
      workspaceId={workspace.workspaceId}
      project={project}
      basePath={`/w/${workspace.slug}/p/${project.slug}/repositories` as Route}
      searchParams={searchParams}
    />
  );
}
