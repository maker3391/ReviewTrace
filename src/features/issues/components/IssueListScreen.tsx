import { Suspense } from "react";
import type { Route } from "next";

import { PageContainer } from "@/components/molecules/PageContainer";
import { IssueFilterBar } from "@/features/issues/components/IssueFilterBar";
import { IssueTable } from "@/features/issues/components/IssueTable";
import { IssueTableSkeleton } from "@/features/issues/components/IssueTableSkeleton";
import {
 issueFilterToQueryString,
 parseIssueFilter,
 type RawSearchParams,
} from "@/features/issues/schemas/issue-filter";
import type { IssueQueryScope } from "@/features/issues/server/issue-query";
import { readMessages } from "@/lib/ui/appearance";

/**
 * Issue 목록 화면.
 *
 * `app/` 은 얇게 두고 화면 조립은 Feature 가 한다.
 *
 * 조회 흐름:
 * ```
 * Search/Filter -> URL Search Params 변경 -> 이 Server Component 재실행
 * -> Suspense Boundary -> Table Skeleton -> 새 Result
 * ```
 *
 * 🔴 **Issue 는 Project 안에서 본다**(스펙 3). Workspace 전체를 가로지르는 목록은 두지
 * 않는다 — 그 자리는 Workspace Dashboard 의 「Needs Attention」이 맡는다.
 */
export async function IssueListScreen({
 scope,
 basePath,
 searchParams,
}: {
 /** 🔴 소속 확인을 통과한 값만 들어온다. URL 의 slug 를 그대로 넣지 않는다. */
 scope: IssueQueryScope;
 /** 주소를 다시 만들기 위한 값. 조회 조건이 아니다. */
 basePath: Route;
 searchParams: Promise<RawSearchParams>;
}) {
 const filter = parseIssueFilter(await searchParams);
 const messages = await readMessages();
 const t = messages.issues;
 const label = messages.enums;

 return (
 <PageContainer width="wide">
 {/*
 🔴 **제목을 다시 적지 않는다.** 사이드바에서 「이슈」를 눌러 들어온 화면이라
 맨 위의 「이슈」는 정보를 하나도 더하지 않는다 — 그 자리를 비우면 Filter 줄이
 곧바로 서서 화면이 바로 일을 시작한다.
 */}
 <IssueFilterBar
 basePath={basePath}
 filter={filter}
 labels={{
...t.filter,
 severityOptions: label.severity,
 categoryOptions: label.category,
 statusOptions: label.status,
 }}
 />

 {/*
 🔴 key 가 Filter 마다 바뀌어야 새 Suspense Boundary 가 열려 Skeleton 이 보인다.
 key 를 고정하면 조회 중에도 옛 결과가 그대로 남아 「눌렀는데 반응이 없는」 화면이 된다.
 반대로 이 경계를 상단 Toolbar 까지 감싸면 페이지 전체가 깜빡인다.
 */}
 <Suspense
 key={issueFilterToQueryString(filter)}
 fallback={
 <IssueTableSkeleton
 labels={{
 colSeverity: t.colSeverity,
 colTitle: t.colTitle,
 colCategory: t.colCategory,
 colLocation: t.colLocation,
 colStatus: t.colStatus,
 colDetected: t.colDetected,
 }}
 />
 }
 >
 <IssueTable scope={scope} filter={filter} basePath={basePath} />
 </Suspense>
 </PageContainer>
);
}
