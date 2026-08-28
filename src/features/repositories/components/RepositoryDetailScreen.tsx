import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { StatRow } from "@/components/molecules/StatRow";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRepositoryOpenIssues } from "@/features/issues/server/issue-detail-query";
import { MoveRepositoryDialog } from "@/features/repositories/components/MoveRepositoryDialog";
import type { RepositoryDetail } from "@/features/repositories/server/repository-query";
import { listRepositoryReviews } from "@/features/reviews/server/review-query";
import { formatAgeInDays, formatDate } from "@/lib/format/date";
import type { ProjectScope } from "@/types/tenant";

/** 상세 화면이 펼치는 행 수. 전체는 각 목록 화면이 답한다. */
const SECTION_LIMIT = 10;

/**
 * 밖으로 나가는 링크로 그려도 되는 주소인가.
 *
 * 🔴 **Schema 가 이미 막는데도 여기서 한 번 더 보는 이유는 «이미 저장된 행» 때문이다.**
 * `htmlUrl` 의 Scheme 검사(`review-ingest.ts`)는 앞으로 들어올 값에만 걸린다 —
 * 그 전에 들어온 행은 Database 에 그대로 남아 있고, 화면은 그것을 읽어 그린다.
 * 입력을 고쳤다고 저장된 값이 안전해지지 않는다.
 *
 * 판정을 Renderer 에 맡기지 않는다. React 19 는 `javascript:` 를 막지만 `data:` 는 막지
 * 않고, 그것은 우리가 정한 계약이 아니라 그 Library 버전의 동작이다.
 */
function isSafeExternalUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    // 파싱되지 않는 값은 링크로 만들지 않는다.
    return false;
  }
}

/**
 * Repository 상세.
 *
 * 🔴 **Source Code 를 담지 않는다**(CLAUDE.md 15). 저장 대상은 Review Knowledge 다 —
 * 이 화면이 답하는 것은 「이 저장소에서 무엇이 반복되고 무엇이 남아 있는가」다.
 */
export async function RepositoryDetailScreen({
  scope,
  repository,
  workspaceSlug,
  projectSlug,
  issuesPath,
  reviewsPath,
  projectOptions,
}: {
  /** 🔴 소속 확인을 통과한 값. */
  scope: ProjectScope;
  repository: RepositoryDetail;
  workspaceSlug: string;
  projectSlug: string;
  issuesPath: Route;
  reviewsPath: Route;
  /** 옮길 수 있는 Project 목록. 같은 Workspace 것만 서버가 골라 넘긴다. */
  projectOptions: readonly { slug: string; name: string }[];
}) {
  const [openIssues, reviews] = await Promise.all([
    listRepositoryOpenIssues(scope, repository.id, SECTION_LIMIT),
    listRepositoryReviews(scope, repository.id, SECTION_LIMIT),
  ]);

  const now = new Date();

  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-tight">
            {repository.fullName}
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {repository.provider} · {repository.defaultBranch}
            {!repository.isActive && " · 연결 해제됨"}
            {repository.htmlUrl !== null &&
              isSafeExternalUrl(repository.htmlUrl) && (
                <>
                  {" · "}
                  <a
                    href={repository.htmlUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    GitHub
                  </a>
                </>
              )}
          </p>
        </div>
        <MoveRepositoryDialog
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          repositoryId={repository.id}
          repositoryFullName={repository.fullName}
          projectOptions={projectOptions}
        />
      </header>

      <Section title="Overview">
        <div className="pt-4">
          <StatRow
            stats={[
              { label: "Reviews", value: repository.reviewCount },
              { label: "Open", value: repository.openIssueCount, hint: "현재" },
              {
                label: "최근 Review",
                value:
                  repository.lastReviewAt === null
                    ? null
                    : formatDate(repository.lastReviewAt),
              },
              { label: "등록", value: formatDate(repository.createdAt) },
            ]}
          />
        </div>
      </Section>

      <Section
        title="Open Issues"
        action={{ label: "전체 보기", href: issuesPath }}
      >
        {openIssues.length === 0 ? (
          <SectionEmpty>열려 있는 Issue 가 없습니다.</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-56">Location</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-20 text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openIssues.map((issue) => (
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
                    <CodeLocation filePath={issue.filePath} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={issue.status} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatAgeInDays(issue.firstDetectedAt, now)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Recent Reviews"
        action={{ label: "전체 보기", href: reviewsPath }}
      >
        {reviews.length === 0 ? (
          <SectionEmpty>Review 가 없습니다.</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Reviewer</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="w-20 text-right">Issues</TableHead>
                <TableHead className="w-28 text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>
                    <Link
                      href={`${reviewsPath}/${review.id}` as Route}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {review.reviewerName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {review.targetType}
                    {review.branch !== null && ` · ${review.branch}`}
                    {review.commitSha !== null &&
                      ` · ${review.commitSha.slice(0, 7)}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {review.issueCount}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatDate(review.createdAt)}
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
