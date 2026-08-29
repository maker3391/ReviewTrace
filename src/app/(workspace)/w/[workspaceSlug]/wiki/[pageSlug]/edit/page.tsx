import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageFormScreen } from "@/features/knowledge/components/KnowledgePageFormScreen";
import { findKnowledgePage } from "@/features/knowledge/server/knowledge-page-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.wikiEdit };
}

export default async function EditWorkspaceKnowledgePage({
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

  if (page === null) {
    notFound();
  }

  return (
    <KnowledgePageFormScreen
      workspaceSlug={workspace.slug}
      projectSlug={null}
      listPath={`/w/${workspace.slug}/wiki` as Route}
      current={{ slug: page.slug, title: page.title, content: page.content }}
    />
  );
}
