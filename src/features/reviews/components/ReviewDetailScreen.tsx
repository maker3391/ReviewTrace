import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { MetaDot, PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReviewDetail } from "@/features/reviews/server/review-query";
import { formatDate } from "@/lib/format/date";

/**
 * ReviewSession 상세 — **한 번의 Review 실행**이 무엇을 남겼는가.
 *
 * 🔴 **PR 을 앞세우지 않는다.** Review 대상은 `COMMIT`·`BRANCH`·`REPOSITORY`·`MANUAL` 일 수
 * 있고, PR 은 Optional Metadata 일 뿐이다(CLAUDE.md 2).
 *
 * 🔴 **Issue 상태는 «지금» 값이다.** 이 Review 가 발견했을 때의 상태가 아니라, 그 뒤
 * Fix·Re-review 를 거친 현재 상태다 — 그 과정은 Issue 상세의 History 가 보여 준다.
 */
export function ReviewDetailScreen({
  review,
  reviewsPath,
  issuesPath,
  repositoriesPath,
}: {
  review: ReviewDetail;
  /** 목록으로 돌아가는 주소. 상세의 한 층 위다. */
  reviewsPath: Route;
  issuesPath: Route;
  repositoriesPath: Route;
}) {
  return (
    /*
      🔴 상세 화면의 결을 Issue 상세와 맞춘다.

      같은 「상세」인데 한쪽만 평면 divider 목록이면 의도된 구분처럼 읽히지 않고 갱신이
      덜 된 화면처럼 보인다. 다만 Review 는 Issue 와 달리 «곁에서 조작할 것»이 없어
      두 단으로 나누지 않고 한 단으로 둔다 — 구조는 정보의 성격을 따른다(CLAUDE.md 16).
    */
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
      <PageHeader
        breadcrumb={{ label: "Reviews", href: reviewsPath }}
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
            <span>{review.reviewerType}</span>
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

      <Section title="대상" variant="raised">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-6 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Type</dt>
          <dd className="font-mono">{review.targetType}</dd>

          <dt className="text-muted-foreground">Branch</dt>
          <dd className="font-mono">{review.branch ?? "—"}</dd>

          <dt className="text-muted-foreground">Commit</dt>
          <dd className="font-mono">{review.commitSha ?? "—"}</dd>

          {/* PR 은 있을 때만 그린다 — 없는 칸을 늘어놓지 않는다. */}
          {review.pullRequestNumber !== null && (
            <>
              <dt className="text-muted-foreground">Pull Request</dt>
              <dd className="font-mono">#{review.pullRequestNumber}</dd>
            </>
          )}

          <dt className="text-muted-foreground">실행</dt>
          <dd className="tabular-nums">
            {formatDate(review.startedAt)}
            {review.completedAt !== null &&
              ` → ${formatDate(review.completedAt)}`}
          </dd>
        </dl>
      </Section>

      {review.summary !== null && (
        <Section title="요약" variant="raised">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {review.summary}
          </p>
        </Section>
      )}

      <Section
        title="발견한 Issue"
        description={`${review.issues.length}건 · 상태는 현재 값`}
        variant="raised"
        bleed
      >
        {review.issues.length === 0 ? (
          <SectionEmpty title="문제를 찾지 못했습니다">
            그것도 기록입니다 — 「이 Commit 은 깨끗했다」가 남습니다.
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-56">Location</TableHead>
                <TableHead className="w-28">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {review.issues.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <SeverityBadge severity={issue.severity} />
                  </TableCell>
                  <TableCell className="max-w-md">
                    <Link
                      href={`${issuesPath}/${issue.id}` as Route}
                      title={issue.title}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {issue.category}
                    </span>
                  </TableCell>
                  <TableCell>
                    <CodeLocation
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
      </Section>
    </div>
  );
}
