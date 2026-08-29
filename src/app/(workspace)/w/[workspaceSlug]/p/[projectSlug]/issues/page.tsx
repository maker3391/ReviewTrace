import type { Metadata } from "next";
import type { Route } from "next";

import { IssueListScreen } from "@/features/issues/components/IssueListScreen";
import type { RawSearchParams } from "@/features/issues/schemas/issue-filter";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.issues };
}

/**
 * `app/` 은 얇게 유지한다 — 화면 조립은 Feature 가 한다(CLAUDE.md 6).
 *
 * `searchParams` 는 풀지 않고 그대로 넘긴다 — 어떤 값을 어떻게 해석할지는 Feature 의
 * Schema 가 정한다.
 */
export default async function ProjectIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  return (
    <IssueListScreen
      scope={{
        workspaceId: workspace.workspaceId,
        projectId: project.projectId,
      }}
      basePath={`/w/${workspace.slug}/p/${project.slug}/issues` as Route}
      searchParams={searchParams}
    />
  );
}
