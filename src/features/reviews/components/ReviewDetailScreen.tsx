import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { PageContainer } from "@/components/molecules/PageContainer";
import { MetaDot, PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { TablePagination } from "@/components/organisms/TablePagination";
import {
  NAME_CELL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReviewDetail } from "@/features/reviews/server/review-query";
import { formatDate } from "@/lib/format/date";
import { listPageHref, type PageRequest } from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";

/**
 * ReviewSession 상세 — **한 번의 Review 실행**이 무엇을 남겼는가.
 *
 * 🔴 **PR 을 앞세우지 않는다.** Review 대상은 `COMMIT`·`BRANCH`·`REPOSITORY`·`MANUAL` 일 수
 * 있고, PR 은 Optional Metadata 일 뿐이다(CLAUDE.md 2).
 *
 * 🔴 **Issue 상태는 «지금» 값이다.** 이 Review 가 발견했을 때의 상태가 아니라, 그 뒤
 * Fix·Re-review 를 거친 현재 상태다 — 그 과정은 Issue 상세의 History 가 보여 준다.
 */
export async function ReviewDetailScreen({
  review,
  reviewsPath,
  issuesPath,
  repositoriesPath,
  detailPath,
  request,
}: {
  review: ReviewDetail;
  /** 이동 줄이 되돌아올 자기 주소. 쪽 번호만 바뀐다. */
  detailPath: Route;
  /** 지금 그리는 쪽·쪽당 개수. 이동 줄이 그대로 이어 쓴다. */
  request: PageRequest;
  /** 목록으로 돌아가는 주소. 상세의 한 층 위다. */
  reviewsPath: Route;
  issuesPath: Route;
  repositoriesPath: Route;
}) {
  const messages = await readMessages();
  const t = messages.reviewDetail;

  return (
    /*
      🔴 상세 화면의 결을 Issue 상세와 맞춘다.

      같은 「상세」인데 한쪽만 평면 divider 목록이면 의도된 구분처럼 읽히지 않고 갱신이
      덜 된 화면처럼 보인다. 다만 Review 는 Issue 와 달리 «곁에서 조작할 것»이 없어
      두 단으로 나누지 않고 한 단으로 둔다 — 구조는 정보의 성격을 따른다(CLAUDE.md 16).
    */
    <PageContainer width="wide">
      <PageHeader
        breadcrumb={{ label: messages.nav.project.REVIEWS, href: reviewsPath }}
        title={review.reviewerName}
        meta={
          <>
            <Link
              href={`${repositoriesPath}/${review.repositoryId}` as Route}
              className="font-mono underline-offset-4 hover:text-foreground hover:underline"
            >
              {review.repositoryFullName}
            </Link>
            <MetaDot />
            <span>{messages.enums.reviewerType[review.reviewerType]}</span>
            {review.reviewerVersion !== null && (
              <>
                <MetaDot />
                <span className="font-mono">{review.reviewerVersion}</span>
              </>
            )}
            <MetaDot />
            <span>{formatDate(review.createdAt)}</span>
          </>
        }
      />

      <Section title={t.target} variant="raised">
        {/*
          🔴 **`1fr` 은 「남는 폭」이 아니라 「min-content 아래로는 안 줄어드는 폭」이다.**
          Commit SHA 40자는 끊을 자리가 없어 그 칸의 min-content 가 288px 이고, 목록 전체가
          424px 을 요구했다. Section 이 `overflow-hidden` 이라 390px 에서 SHA 가 **스크롤도
          없이 잘려 아예 읽히지 않았다**(실측: dl 424 / 자리 252).

          `minmax(0,1fr)` 로 값 칸이 줄어들 수 있게 하고, `wrap-anywhere` 로 SHA 를 여러
          줄에 걸쳐 «전부» 보이게 한다. 이름 칸은 좁을 때만 5rem 으로 줄어든다 — `sm` 위로는
          7rem 그대로다.
        */}
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs wrap-anywhere sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-6">
          <dt className="text-muted-foreground">{t.targetType}</dt>
          <dd>{messages.enums.targetType[review.targetType]}</dd>

          <dt className="text-muted-foreground">{t.branch}</dt>
          <dd className="font-mono">{review.branch ?? "—"}</dd>

          <dt className="text-muted-foreground">{t.commit}</dt>
          <dd className="font-mono">{review.commitSha ?? "—"}</dd>

          {/* PR 은 있을 때만 그린다 — 없는 칸을 늘어놓지 않는다. */}
          {review.pullRequestNumber !== null && (
            <>
              <dt className="text-muted-foreground">{t.pullRequest}</dt>
              <dd className="font-mono">#{review.pullRequestNumber}</dd>
            </>
          )}

          <dt className="text-muted-foreground">{t.ranAt}</dt>
          <dd className="tabular-nums">
            {formatDate(review.startedAt)}
            {review.completedAt !== null &&
              ` → ${formatDate(review.completedAt)}`}
          </dd>
        </dl>
      </Section>

      {review.summary !== null && (
        <Section title={t.summary} variant="raised">
          <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">
            {review.summary}
          </p>
        </Section>
      )}

      <Section
        title={t.foundIssues}
        /* 🔴 «이 쪽에 몇 개」가 아니라 «이 Review 가 몇 건을 남겼나»다. */
        description={t.foundIssuesHint(review.issues.total)}
        variant="raised"
        bleed
      >
        {review.issues.total === 0 ? (
          <SectionEmpty title={t.clean}>
            {t.cleanHint}
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  {messages.issues.colSeverity}
                </TableHead>
                <TableHead>{messages.issues.colTitle}</TableHead>
                <TableHead className="w-56">
                  {messages.issues.colLocation}
                </TableHead>
                <TableHead className="w-28">
                  {messages.issues.colStatus}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {review.issues.items.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <SeverityBadge severity={issue.severity} />
                  </TableCell>
                  <TableCell className={NAME_CELL}>
                    <Link
                      href={`${issuesPath}/${issue.id}` as Route}
                      title={issue.title}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {messages.enums.category[issue.category]}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[14rem] overflow-hidden">
                    <CodeLocation
                      className="block truncate"
                      filePath={issue.filePath}
                      lineStart={issue.startLine}
                      lineEnd={issue.endLine}
                    />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={issue.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/*
          🔴 **Agent API 는 한 Review 에 최대 500건을 받는다**(CLAUDE.md 13). 목록 화면
          전부에 이동 줄을 넣으면서 이 자리만 빠져 있어 500행이 한 화면에 쏟아졌다.
          🔴 한 쪽에 다 들어가면 그리지 않는다 — `TablePagination` 이 스스로 판단한다.
        */}
        {review.issues.total > 0 && (
          <TablePagination
            total={review.issues.total}
            page={review.issues.page}
            pageSize={review.issues.pageSize}
            pageHref={(page) =>
              listPageHref(detailPath, { ...request, page }) as Route
            }
            pageSizeHref={(pageSize) =>
              listPageHref(detailPath, { page: 1, pageSize }) as Route
            }
            labels={messages.common.pagination}
          />
        )}
      </Section>
    </PageContainer>
  );
}
