import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
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
  issuesPath,
  repositoriesPath,
}: {
  review: ReviewDetail;
  issuesPath: Route;
  repositoriesPath: Route;
}) {
  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">
          {review.reviewerName}
          {review.reviewerVersion !== null && (
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
              {review.reviewerVersion}
            </span>
          )}
        </h1>
        <p className="text-[11px] text-muted-foreground">
          <Link
            href={`${repositoriesPath}/${review.repositoryId}` as Route}
            className="font-mono underline-offset-2 hover:text-foreground hover:underline"
          >
            {review.repositoryFullName}
          </Link>
          {" · "}
          {review.reviewerType}
          {" · "}
          {formatDate(review.createdAt)}
        </p>
      </header>

      <Section title="대상">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-6 gap-y-1.5 pt-3 text-xs">
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
        <Section title="요약">
          <p className="whitespace-pre-wrap pt-2 text-sm leading-relaxed">
            {review.summary}
          </p>
        </Section>
      )}

      <Section
        title="발견한 Issue"
        description={`${review.issues.length}건 · 상태는 현재 값`}
      >
        {review.issues.length === 0 ? (
          <SectionEmpty>
            이 Review 는 문제를 찾지 못했습니다 — 그것도 기록입니다.
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
                  <TableCell>
                    <Link
                      href={`${issuesPath}/${issue.id}` as Route}
                      className="font-medium underline-offset-2 hover:underline"
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
