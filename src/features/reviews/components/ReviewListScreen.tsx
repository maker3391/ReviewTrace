import Link from "next/link";
import type { Route } from "next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListChecks } from "lucide-react";

import { PageContainer } from "@/components/molecules/PageContainer";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { TablePagination } from "@/components/organisms/TablePagination";
import {
  REVIEW_COL,
  REVIEW_TABLE,
} from "@/features/reviews/components/review-table-columns";
import type { ReviewListItem } from "@/features/reviews/server/review-query";
import { findProjectReviewPage } from "@/features/reviews/server/review-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";
import {
  listPageHref,
  parsePageRequest,
  type RawSearchParams,
} from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";

/**
 * Project 의 Review 목록.
 *
 * 🔴 **Review 대상은 Pull Request 에 한정하지 않는다**(CLAUDE.md 2). `targetType` 이
 * `COMMIT`·`BRANCH`·`REPOSITORY`·`MANUAL` 일 수 있으므로 PR 번호를 앞세우지 않는다 —
 * PR 은 Optional Metadata 다.
 *
 * 🔴 **제목을 다시 적지 않는다.** 사이드바에서 「리뷰」를 눌러 온 화면 맨 위에 「리뷰」를
 * 한 번 더 찍는 것은 정보가 아니라 같은 낱말의 반복이다(CLAUDE.md 16).
 */
export async function ReviewListScreen({
  workspaceId,
  project,
  basePath,
  searchParams,
}: {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  project: ProjectContext;
  /** 상세로 들어가는 주소의 뿌리. */
  basePath: Route;
  /** 쪽 상태는 URL 에 있다(CLAUDE.md 8) — 새로고침·주소 공유로 같은 쪽이 다시 나온다. */
  searchParams: Promise<RawSearchParams>;
}) {
  const request = parsePageRequest(await searchParams);
  const [reviewPage, messages] = await Promise.all([
    findProjectReviewPage({ workspaceId, projectId: project.projectId }, request),
    readMessages(),
  ]);
  const reviews = reviewPage.items;
  const t = messages.reviews;
  const label = messages.enums;

  return (
    <PageContainer width="wide">
      <Section variant="raised" bleed>
        {reviews.length === 0 ? (
          <SectionEmpty icon={<ListChecks className="size-4" />} title={t.empty}>
            {t.emptyHint}
          </SectionEmpty>
        ) : (
          <Table className={REVIEW_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className={REVIEW_COL.reviewer}>
                  {t.colReviewer}
                </TableHead>
                <TableHead className={REVIEW_COL.repository}>
                  {t.colRepository}
                </TableHead>
                <TableHead className={REVIEW_COL.target}>
                  {t.colTarget}
                </TableHead>
                <TableHead className={REVIEW_COL.issues}>
                  {t.colIssues}
                </TableHead>
                <TableHead className={REVIEW_COL.date}>{t.colDate}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => {
                const target = describeTarget(
                  review,
                  label.targetType[review.targetType],
                );

                return (
                  <TableRow key={review.id}>
                    <TableCell className={REVIEW_COL.reviewer}>
                      <Link
                        href={`${basePath}/${review.id}` as Route}
                        title={review.reviewerName}
                        className="block truncate font-medium underline-offset-2 hover:underline"
                      >
                        {review.reviewerName}
                      </Link>
                    </TableCell>
                    {/*
                      🔴 **식별자를 글자 단위로 접지 않는다.** 예전에는 `break-all` 이라
                      `SMIL-26/very-long-repository-name-…` 한 줄이 여덟 줄로 접혀 행 높이가
                      혼자 늘어났다. 한 줄로 두고 잘라 낸 뒤 전문은 `title` 로 확인한다 —
                      이 저장소의 기존 방식이다(Issue 목록·Project Dashboard).
                    */}
                    <TableCell
                      className={cn(
                        REVIEW_COL.repository,
                        "truncate font-mono text-xs text-muted-foreground",
                      )}
                      title={review.repositoryFullName}
                    >
                      {review.repositoryFullName}
                    </TableCell>
                    {/*
                      「무엇을 봤는가」는 한 덩어리다 — 종류와 실제 branch/commit 을 열 둘로
                      쪼개면 표가 옆으로 길어지고 정작 값이 좁아진다(CLAUDE.md 16).
                      실제 값이 주가 되고 종류는 그 아래 보조 줄로 내린다.
                    */}
                    <TableCell className={REVIEW_COL.target}>
                      <span
                        className="block truncate font-mono text-xs"
                        title={target.full}
                      >
                        {target.primary}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {target.secondary}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(REVIEW_COL.issues, "tabular-nums")}
                    >
                      {review.issueCount}
                    </TableCell>
                    <TableCell
                      className={cn(
                        REVIEW_COL.date,
                        "text-xs tabular-nums text-muted-foreground",
                      )}
                    >
                      {formatDate(review.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* 🔴 결과가 하나도 없으면 「0건」도 그리지 않는다 — Empty State 가 이미 말했다. */}
        {reviewPage.total > 0 && (
          <TablePagination
            total={reviewPage.total}
            page={reviewPage.page}
            pageSize={reviewPage.pageSize}
            pageHref={(page) =>
              listPageHref(basePath, { ...request, page }) as Route
            }
            pageSizeHref={(pageSize) =>
              listPageHref(basePath, { page: 1, pageSize }) as Route
            }
            labels={messages.common.pagination}
          />
        )}
      </Section>
    </PageContainer>
  );
}

/**
 * 「무엇을 봤는가」 한 칸.
 *
 * 🔴 **`targetType` 에 없는 값을 지어내지 않는다.** 값은 `PULL_REQUEST`·`COMMIT`·`BRANCH`·
 * `REPOSITORY`·`MANUAL` 다섯뿐이고(`types/review.ts`), `branch`·`commitSha` 는 **둘 다
 * Nullable** 이다(`db/schema/review.ts`). 그래서 종류만으로 무엇을 그릴지 정하지 않고
 * **실제로 있는 값 중 가장 구체적인 것**을 앞줄에 세운다.
 *
 * ```
 * branch 있음          feature/auth-…      Commit · a81f3c2
 * branch 없음·SHA 있음  a81f3c2             Commit
 * 둘 다 없음            —                   Manual
 * ```
 *
 * 종류는 언제나 아랫줄에 남으므로 **행 높이가 데이터에 따라 들쭉날쭉해지지 않는다.**
 *
 * 🔴 **목록에는 짧은 SHA 만 쓴다.** 40자는 끊을 자리가 없어 어떤 폭에서도 칸을 밀어낸다 —
 * 전체 값은 Review 상세에 있다(`ReviewDetailScreen`).
 */
function describeTarget(
  review: Pick<ReviewListItem, "branch" | "commitSha">,
  typeLabel: string,
): { primary: string; secondary: string; full: string | undefined } {
  const shortSha =
    review.commitSha === null ? null : review.commitSha.slice(0, 7);

  if (review.branch !== null) {
    return {
      primary: review.branch,
      secondary: shortSha === null ? typeLabel : `${typeLabel} · ${shortSha}`,
      full: review.branch,
    };
  }

  if (shortSha !== null) {
    return {
      primary: shortSha,
      secondary: typeLabel,
      // 상세로 가기 전에도 전체 SHA 를 확인할 수 있게 한다.
      full: review.commitSha ?? undefined,
    };
  }

  return { primary: "—", secondary: typeLabel, full: undefined };
}
