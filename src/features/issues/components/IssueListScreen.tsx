import { Suspense } from "react";

import { sectionHref } from "@/config/navigation";
import { IssueFilterBar } from "@/features/issues/components/IssueFilterBar";
import { IssueTable } from "@/features/issues/components/IssueTable";
import { IssueTableSkeleton } from "@/features/issues/components/IssueTableSkeleton";
import {
  issueFilterToQueryString,
  parseIssueFilter,
  type RawSearchParams,
} from "@/features/issues/schemas/issue-filter";

/**
 * Issue 목록 화면.
 *
 * `app/` 은 얇게 두고 화면 조립은 Feature 가 한다(CLAUDE.md 6).
 *
 * 조회 흐름:
 * ```
 * Search/Filter -> URL Search Params 변경 -> 이 Server Component 재실행
 *   -> Suspense Boundary -> Table Skeleton -> 새 Result
 * ```
 */
export async function IssueListScreen({
  workspaceId,
  workspaceSlug,
  searchParams,
}: {
  /** 🔴 소속 확인을 통과한 값만 들어온다. URL 의 slug 를 그대로 넣지 않는다(CLAUDE.md 11). */
  workspaceId: string;
  /** 주소를 다시 만들기 위한 값. 조회 조건이 아니다. */
  workspaceSlug: string;
  searchParams: Promise<RawSearchParams>;
}) {
  const filter = parseIssueFilter(await searchParams);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h1 className="text-base font-semibold tracking-tight">Issues</h1>
        <p className="text-xs text-muted-foreground">
          Agent 와 사람이 남긴 Code Issue
        </p>
      </div>

      <IssueFilterBar basePath={sectionHref(workspaceSlug, "issues")} filter={filter} />

      {/*
        🔴 key 가 Filter 마다 바뀌어야 새 Suspense Boundary 가 열려 Skeleton 이 보인다.
        key 를 고정하면 조회 중에도 옛 결과가 그대로 남아 「눌렀는데 반응이 없는」 화면이 된다.
        반대로 이 경계를 상단 Toolbar 까지 감싸면 페이지 전체가 깜빡인다.
      */}
      <Suspense
        key={issueFilterToQueryString(filter)}
        fallback={<IssueTableSkeleton />}
      >
        <IssueTable workspaceId={workspaceId} filter={filter} />
      </Suspense>
    </div>
  );
}
