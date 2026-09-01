import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageFormScreen } from "@/features/knowledge/components/KnowledgePageFormScreen";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.wikiNew };
}

export default async function NewProjectKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  // 🔴 작성 화면도 소속을 확인하고 연다. 저장은 Server Action 이 다시 확인한다.
  const { workspace, project } = await requireProject(
    workspaceSlug,
    projectSlug,
  );

  return (
    <KnowledgePageFormScreen
      workspaceSlug={workspace.slug}
      projectSlug={project.slug}
      listPath={`/w/${workspace.slug}/p/${project.slug}/wiki` as Route}
      current={null}
    />
  );
}
