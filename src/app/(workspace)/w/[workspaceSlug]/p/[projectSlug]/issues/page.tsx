import type { Metadata } from "next";
import type { Route } from "next";

import { IssueListScreen } from "@/features/issues/components/IssueListScreen";
import type { RawSearchParams } from "@/features/issues/schemas/issue-filter";
import { listRepositoryOptions } from "@/features/repositories/server/repository-query";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.issues };
}

/**
 * `app/` 은 얇게 유지한다 — 화면 조립은 Feature 가 한다.
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
  const { workspace, project } = await requireProject(
    workspaceSlug,
    projectSlug,
  );

  const scope = {
    workspaceId: workspace.workspaceId,
    projectId: project.projectId,
  };
  /*
 저장소 Filter 의 선택지.

 🔴 **조회는 두 Feature 에 걸쳐 있고, 잇는 자리가 여기다**(스펙 6) — Issue 화면이
 `repositories` 표를 직접 읽으면 Feature 끼리 서로의 조회를 알게 된다.
 🔴 범위는 인가를 통과한 `scope` 하나뿐이다. URL 의 slug 를 그대로 쓰지 않는다.
 */
  const repositories = await listRepositoryOptions(scope);

  return (
    <IssueListScreen
      scope={scope}
      repositories={repositories}
      basePath={`/w/${workspace.slug}/p/${project.slug}/issues` as Route}
      searchParams={searchParams}
    />
  );
}
