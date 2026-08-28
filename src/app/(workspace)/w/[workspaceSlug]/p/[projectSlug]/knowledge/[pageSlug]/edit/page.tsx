import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageForm } from "@/features/knowledge/components/KnowledgePageForm";
import { findKnowledgePage } from "@/features/knowledge/server/knowledge-page-service";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "문서 수정",
};

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
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  const page = await findKnowledgePage(
    { workspaceId: workspace.workspaceId, projectId: project.projectId },
    pageSlug,
  );

  if (page === null) {
    notFound();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="px-4 pt-4 text-base font-semibold tracking-tight">
        문서 수정
      </h1>
      <KnowledgePageForm
        workspaceSlug={workspace.slug}
        projectSlug={project.slug}
        listPath={`/w/${workspace.slug}/p/${project.slug}/knowledge` as Route}
        current={{ slug: page.slug, title: page.title, content: page.content }}
      />
    </div>
  );
}
