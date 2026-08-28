import type { Metadata } from "next";

import { IssueListScreen } from "@/features/issues/components/IssueListScreen";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import type { RawSearchParams } from "@/features/issues/schemas/issue-filter";

export const metadata: Metadata = {
  title: "Issues",
};

/**
 * `app/` 은 얇게 유지한다 — 화면 조립은 Feature 가 한다(CLAUDE.md 6).
 *
 * 🔴 **Workspace 는 서버가 정한다.** URL 의 slug 는 Context 표시일 뿐이고, 소속 확인을
 * 통과한 `workspace.workspaceId` 만 조회에 들어간다(CLAUDE.md 11).
 *
 * `searchParams` 는 풀지 않고 그대로 넘긴다 — 어떤 값을 어떻게 해석할지는 Feature 의 Schema 가 정한다.
 */
export default async function WorkspaceIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);

  return (
    <IssueListScreen
      workspaceId={workspace.workspaceId}
      workspaceSlug={workspace.slug}
      searchParams={searchParams}
    />
  );
}
