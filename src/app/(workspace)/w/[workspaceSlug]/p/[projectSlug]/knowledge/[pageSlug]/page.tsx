import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageView } from "@/features/knowledge/components/KnowledgePageView";
import { findKnowledgePage } from "@/features/knowledge/server/knowledge-page-service";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "Knowledge",
};

export default async function ProjectKnowledgeDetailPage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    pageSlug: string;
  }>;
}) {
  const { workspaceSlug, projectSlug, pageSlug } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  const page = await findKnowledgePage(
    { workspaceId: workspace.workspaceId, projectId: project.projectId },
    pageSlug,
  );

  // 🔴 Scope 밖의 문서는 「없는 것」이다. Workspace 문서를 Project 주소로 열어 주지 않는다.
  if (page === null) {
    notFound();
  }

  return (
    <KnowledgePageView
      page={page}
      workspaceSlug={workspace.slug}
      projectSlug={project.slug}
      basePath={`/w/${workspace.slug}/p/${project.slug}/knowledge` as Route}
    />
  );
}
