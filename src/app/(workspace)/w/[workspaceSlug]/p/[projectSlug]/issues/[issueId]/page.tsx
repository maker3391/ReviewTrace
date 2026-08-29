import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { IssueDetailScreen } from "@/features/issues/components/IssueDetailScreen";
import { findIssueDetail } from "@/features/issues/server/issue-detail-query";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.issue };
}

/**
 * 🔴 UUID 가 아닌 값이 들어와도 Driver 가 던지지 않게 조회가 `null` 로 끝나야 한다.
 * `findIssueDetail` 은 `eq(id, ...)` 를 쓰므로 형식이 틀리면 Postgres 가 거절한다 —
 * 그래서 먼저 형식을 본다.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectIssueDetailPage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    issueId: string;
  }>;
}) {
  const { workspaceSlug, projectSlug, issueId } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  if (!UUID.test(issueId)) {
    notFound();
  }

  const issue = await findIssueDetail(
    { workspaceId: workspace.workspaceId, projectId: project.projectId },
    issueId,
  );

  // 🔴 범위 밖은 「없는 것」이다. 남의 Issue 와 없는 Issue 를 구분해 알려 주지 않는다.
  if (issue === null) {
    notFound();
  }

  const base = `/w/${workspace.slug}/p/${project.slug}`;

  return (
    <IssueDetailScreen
      issue={issue}
      reviewsPath={`${base}/reviews` as Route}
      repositoriesPath={`${base}/repositories` as Route}
    />
  );
}
