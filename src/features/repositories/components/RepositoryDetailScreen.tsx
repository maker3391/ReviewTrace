import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { PageContainer } from "@/components/molecules/PageContainer";
import { MetaDot, PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { StatRow } from "@/components/molecules/StatRow";
import {
  FLEX_CELL,
  NAME_CELL,
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
import { readLocale, readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";
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
  const [openIssues, reviews, locale, messages] = await Promise.all([
    listRepositoryOpenIssues(scope, repository.id, SECTION_LIMIT),
    listRepositoryReviews(scope, repository.id, SECTION_LIMIT),
    readLocale(),
    readMessages(),
  ]);
  const t = messages.repositoryDetail;
  const issueColumns = messages.issues;

  const now = new Date();

  return (
    <PageContainer width="wide">
      <PageHeader
        title={repository.fullName}
        meta={
          <>
            <span>{messages.enums.provider[repository.provider]}</span>
            <MetaDot />
            <span className="font-mono">{repository.defaultBranch}</span>
            {!repository.isActive && (
              <>
                <MetaDot />
                <span>{t.disconnected}</span>
              </>
            )}
            {repository.htmlUrl !== null &&
              isSafeExternalUrl(repository.htmlUrl) && (
                <>
                  <MetaDot />
                  <a
                    href={repository.htmlUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-4 hover:text-foreground hover:underline"
                  >
                    GitHub
                  </a>
                </>
              )}
          </>
        }
        actions={
          <MoveRepositoryDialog
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            repositoryId={repository.id}
            projectOptions={projectOptions}
            labels={{
              trigger: t.move,
              description: t.moveDescription(repository.fullName),
              target: t.moveTarget,
              placeholder: t.movePlaceholder,
              cancel: t.cancel,
              move: t.moveAction,
            }}
          />
        }
      />

      <StatRow
            stats={[
              { label: t.reviews, value: repository.reviewCount },
              {
                label: t.openIssues,
                value: repository.openIssueCount,
                hint: t.now,
              },
              {
                label: t.lastReview,
                value:
                  repository.lastReviewAt === null
                    ? null
                    : formatDate(repository.lastReviewAt),
              },
              { label: t.registered, value: formatDate(repository.createdAt) },
        ]}
      />

      <Section
        title={t.openIssues}
        variant="raised"
        bleed
        action={{ label: messages.common.viewAll, href: issuesPath }}
      >
        {openIssues.length === 0 ? (
          <SectionEmpty>{t.noOpenIssues}</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  {issueColumns.colSeverity}
                </TableHead>
                <TableHead>{issueColumns.colTitle}</TableHead>
                <TableHead className="w-56">
                  {issueColumns.colLocation}
                </TableHead>
                <TableHead className="w-28">{issueColumns.colStatus}</TableHead>
                <TableHead className="w-20 text-right">
                  {messages.projectDashboard.openIssues.colAge}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openIssues.map((issue) => (
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
                    />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={issue.status} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatAgeInDays(issue.firstDetectedAt, now, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title={t.recentReviews}
        variant="raised"
        bleed
        action={{ label: messages.common.viewAll, href: reviewsPath }}
      >
        {reviews.length === 0 ? (
          <SectionEmpty>{t.noReviews}</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">
                  {messages.reviews.colReviewer}
                </TableHead>
                <TableHead>{messages.reviews.colTarget}</TableHead>
                <TableHead className="w-20 text-right">
                  {messages.reviews.colIssues}
                </TableHead>
                <TableHead className="w-28 text-right">
                  {messages.reviews.colDate}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell className="max-w-[10rem]">
                    <Link
                      href={`${reviewsPath}/${review.id}` as Route}
                      title={review.reviewerName}
                      className="block truncate font-medium underline-offset-2 hover:underline"
                    >
                      {review.reviewerName}
                    </Link>
                  </TableCell>
                  <TableCell
                    className={cn(FLEX_CELL, "truncate font-mono text-[11px] text-muted-foreground")}
                  >
                    {messages.enums.targetType[review.targetType]}
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
    </PageContainer>
  );
}
