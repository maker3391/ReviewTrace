import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageFormScreen } from "@/features/knowledge/components/KnowledgePageFormScreen";
import { findKnowledgePage } from "@/features/knowledge/server/knowledge-page-service";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.wikiEdit };
}

export default async function EditProjectKnowledgePage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    pageSlug: string;
  }>;
}) {
  const { workspaceSlug, projectSlug, pageSlug } = await params;
  const { workspace, project } = await requireProject(
    workspaceSlug,
    projectSlug,
  );

  const page = await findKnowledgePage(
    { workspaceId: workspace.workspaceId, projectId: project.projectId },
    pageSlug,
  );

  if (page === null) {
    notFound();
  }

  return (
    <KnowledgePageFormScreen
      workspaceSlug={workspace.slug}
      projectSlug={project.slug}
      listPath={`/w/${workspace.slug}/p/${project.slug}/wiki` as Route}
      current={{ slug: page.slug, title: page.title, content: page.content }}
    />
  );
}
