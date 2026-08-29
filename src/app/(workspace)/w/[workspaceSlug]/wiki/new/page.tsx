import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageFormScreen } from "@/features/knowledge/components/KnowledgePageFormScreen";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.wikiNew };
}

export default async function NewWorkspaceKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  // 🔴 작성 화면도 소속을 확인하고 연다. 저장은 Server Action 이 다시 확인한다.
  const { workspace } = await requireWorkspace(workspaceSlug);

  return (
    <KnowledgePageFormScreen
      workspaceSlug={workspace.slug}
      projectSlug={null}
      listPath={`/w/${workspace.slug}/wiki` as Route}
      current={null}
    />
  );
}
