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
import { Timestamp } from "@/components/atoms/Timestamp";

import { PageContainer } from "@/components/molecules/PageContainer";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { TablePagination } from "@/components/organisms/TablePagination";
import { ReviewTargetCell } from "@/features/reviews/components/ReviewTargetCell";
import {
  REVIEW_COL,
  REVIEW_TABLE,
} from "@/features/reviews/components/review-table-columns";
import { findProjectReviewPage } from "@/features/reviews/server/review-query";
import type { ProjectContext } from "@/features/projects/types/project";
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
 * 🔴 **Review 대상은 Pull Request 에 한정하지 않는다**. `targetType` 이
 * `COMMIT`·`BRANCH`·`REPOSITORY`·`MANUAL` 일 수 있으므로 PR 번호를 앞세우지 않는다 —
 * PR 은 Optional Metadata 다.
 *
 * 🔴 **제목을 다시 적지 않는다.** 사이드바에서 「리뷰」를 눌러 온 화면 맨 위에 「리뷰」를
 * 한 번 더 찍는 것은 정보가 아니라 같은 낱말의 반복이다.
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
  /** 쪽 상태는 URL 에 있다 — 새로고침·주소 공유로 같은 쪽이 다시 나온다. */
  searchParams: Promise<RawSearchParams>;
}) {
  const request = parsePageRequest(await searchParams);
  const [reviewPage, messages] = await Promise.all([
    findProjectReviewPage(
      { workspaceId, projectId: project.projectId },
      request,
    ),
    readMessages(),
  ]);
  const reviews = reviewPage.items;
  const t = messages.reviews;
  const label = messages.enums;

  return (
    <PageContainer width="wide">
      <Section variant="raised" bleed>
        {reviews.length === 0 ? (
          <SectionEmpty
            icon={<ListChecks className="size-4" />}
            title={t.empty}
          />
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
                      <span
                        className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground lg:hidden"
                        title={review.repositoryFullName}
                      >
                        {review.repositoryFullName}
                      </span>
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
 「무엇을 봤는가」는 한 덩어리다 — branch 와 commit 을 열 둘로 쪼개면 표가
 옆으로 길어지고 정작 이름이 묻힌다(CLAUDE.md 16). 한 칸 안에서 한 줄로
 둔다 — 그리는 규칙은 `ReviewTargetCell` 한 곳이고 Project Overview 가
 같은 것을 쓴다.
 */}
                    <ReviewTargetCell
                      review={review}
                      typeLabel={label.targetType[review.targetType]}
                    />
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
                      <Timestamp value={review.createdAt} variant="compact" />
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
