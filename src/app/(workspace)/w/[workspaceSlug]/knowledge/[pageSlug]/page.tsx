import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageView } from "@/features/knowledge/components/KnowledgePageView";
import { findKnowledgePage } from "@/features/knowledge/server/knowledge-page-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export const metadata: Metadata = {
  title: "Knowledge",
};

export default async function WorkspaceKnowledgeDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; pageSlug: string }>;
}) {
  const { workspaceSlug, pageSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);

  const page = await findKnowledgePage(
    { workspaceId: workspace.workspaceId, projectId: null },
    pageSlug,
  );

  // 🔴 Scope 밖의 문서는 「없는 것」이다. 다른 Project 의 문서를 여기서 열어 주지 않는다.
  if (page === null) {
    notFound();
  }

  return (
    <KnowledgePageView
      page={page}
      workspaceSlug={workspace.slug}
      projectSlug={null}
      basePath={`/w/${workspace.slug}/knowledge` as Route}
    />
  );
}
