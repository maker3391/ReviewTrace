import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgeScreen } from "@/features/knowledge/components/KnowledgeScreen";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.wiki };
}

/**
 * Project Wiki — 업무 규칙 · Architecture Decision · 외부 연동 규칙 · 장애 기록처럼
 * **이 Project 안에서만 뜻이 있는 것**(스펙 8).
 *
 * 공통 규칙은 여기 두지 않는다. 그것은 `/w/{ws}/wiki` 다.
 */
export default async function ProjectKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);
  const t = (await readMessages()).wiki;

  return (
    <KnowledgeScreen
      scope={{
        workspaceId: workspace.workspaceId,
        projectId: project.projectId,
      }}
      basePath={`/w/${workspace.slug}/p/${project.slug}/wiki` as Route}
      heading={t.projectHeading}
      description={t.projectDescription(project.name)}
    />
  );
}
