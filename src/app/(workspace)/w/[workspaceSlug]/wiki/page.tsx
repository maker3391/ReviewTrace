import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgeScreen } from "@/features/knowledge/components/KnowledgeScreen";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { readMessages } from "@/lib/ui/appearance";

export const metadata: Metadata = {
  title: "Wiki",
};

/**
 * Workspace Wiki — 개발 공통 규칙 · Git/PR 규칙 · Security 정책처럼
 * **Project 를 가리지 않고 지켜야 하는 것**(스펙 8).
 *
 * Project 이야기는 여기 두지 않는다. 그것은 `/w/{ws}/p/{project}/wiki` 다.
 */
export default async function WorkspaceKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);
  const t = (await readMessages()).wiki;

  return (
    <KnowledgeScreen
      scope={{ workspaceId: workspace.workspaceId, projectId: null }}
      basePath={`/w/${workspace.slug}/wiki` as Route}
      heading={t.workspaceHeading}
      description={t.workspaceDescription}
    />
  );
}
