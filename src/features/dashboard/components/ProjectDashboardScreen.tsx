import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
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
import { PageContainer } from "@/components/molecules/PageContainer";
import { PageHeader } from "@/components/molecules/PageHeader";
import { projectSectionHref } from "@/config/navigation";
import { findProjectDashboard } from "@/features/dashboard/server/project-dashboard-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatAgeInDays, formatDate } from "@/lib/format/date";
import { readLocale, readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";

/**
 * Project Dashboard(스펙 6).
 *
 * **「이 Project 에서 지금 어떤 문제가 나고 있고 무엇이 반복되는가?」** 에 답한다.
 *
 * 🔴 **Repository 상세 Dashboard 로 키우지 않는다.** Repository 별 상태는 「어느 저장소를
 * 봐야 하는가」까지만 보여 주고 그 아래는 Repositories 화면이 답한다(스펙 7).
 */
export async function ProjectDashboardScreen({
  workspaceId,
  workspaceSlug,
  project,
}: {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  workspaceSlug: string;
  /** 🔴 그 Workspace 안에 있음이 확인된 Project. */
  project: ProjectContext;
}) {
  const [dashboard, locale, messages] = await Promise.all([
    findProjectDashboard({ workspaceId, projectId: project.projectId }),
    readLocale(),
    readMessages(),
  ]);
  const t = messages.projectDashboard;
  const label = messages.enums;
  const now = new Date();

  const issuesHref = projectSectionHref(workspaceSlug, project.slug, "issues");
  const reviewsHref = projectSectionHref(workspaceSlug, project.slug, "reviews");
  const wikiHref = projectSectionHref(workspaceSlug, project.slug, "wiki");
  const repositoriesHref = projectSectionHref(
    workspaceSlug,
    project.slug,
    "repositories",
  );

  return (
    <PageContainer width="wide">
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
      />

      <StatRow
        stats={[
          {
            label: t.kpiReviews,
            value: dashboard.kpi.recentReviews,
            hint: t.hintLast30Days,
          },
          {
            label: t.kpiIssues,
            value: dashboard.kpi.recentIssuesFound,
            hint: t.hintLast30Days,
          },
          {
            label: t.kpiOpen,
            value: dashboard.kpi.openIssues,
            hint: t.hintNow,
          },
          {
            label: t.kpiResolutionRate,
            value:
              dashboard.kpi.resolutionRate === null
                ? null
                : `${dashboard.kpi.resolutionRate}%`,
            hint: t.hintFoundLast30Days,
          },
        ]}
      />

      <Section
        title={t.openIssues.title}
        variant="raised"
        bleed
        action={{ label: messages.common.viewAll, href: issuesHref }}
      >
        {dashboard.openIssues.length === 0 ? (
          <SectionEmpty>{t.openIssues.empty}</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  {t.openIssues.colSeverity}
                </TableHead>
                <TableHead>{t.openIssues.colIssue}</TableHead>
                <TableHead className="w-56">
                  {t.openIssues.colLocation}
                </TableHead>
                <TableHead className="w-20 text-right">
                  {t.openIssues.colAge}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.openIssues.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <SeverityBadge severity={issue.severity} />
                  </TableCell>
                  <TableCell className={NAME_CELL}>
                    <span
                      title={issue.title}
                      className="block truncate font-medium"
                    >
                      {issue.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {label.category[issue.category]}
                    </span>
                  </TableCell>
                  {/*
                    🔴 «어디였는가»는 제 폭 안에서 잘려야 한다. 잘라 두지 않으면 긴 Repository
                    이름 하나가 칸 밖으로 흘러 옆의 Age 와 겹쳐 그려진다 — 실제로 그랬다.
                  */}
                  <TableCell className="max-w-[14rem] overflow-hidden">
                    <span
                      className="block truncate font-mono text-[11px] text-muted-foreground"
                      title={issue.repositoryFullName}
                    >
                      {issue.repositoryFullName}
                    </span>
                    <CodeLocation
                      className="block truncate"
                      filePath={issue.filePath}
                    />
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

      <Section title={t.patterns.title} variant="raised" bleed>
        {dashboard.frequentPatterns.length === 0 ? (
          <SectionEmpty>{t.patterns.empty}</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.patterns.colPattern}</TableHead>
                <TableHead className="w-44">{t.patterns.colCategory}</TableHead>
                <TableHead className="w-24 text-right">
                  {t.patterns.colOccurrences}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t.patterns.colResolved}
                </TableHead>
                <TableHead className="w-32 text-right">
                  {t.patterns.colLast}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.frequentPatterns.map((pattern) => (
                <TableRow key={`${pattern.patternKey}-${pattern.category}`}>
                  <TableCell
                    className={cn(FLEX_CELL, "truncate font-mono text-xs font-medium")}
                    title={pattern.patternKey}
                  >
                    {pattern.patternKey}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {label.category[pattern.category]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pattern.occurrences}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {pattern.resolvedCount}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatDate(pattern.lastDetectedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title={t.recentReviews.title}
        variant="raised"
        bleed
        action={{ label: messages.common.viewAll, href: reviewsHref }}
      >
        {dashboard.recentReviews.length === 0 ? (
          <SectionEmpty>{t.recentReviews.empty}</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">
                  {t.recentReviews.colReviewer}
                </TableHead>
                <TableHead>{t.recentReviews.colRepository}</TableHead>
                <TableHead className="w-56">
                  {t.recentReviews.colTarget}
                </TableHead>
                <TableHead className="w-20 text-right">
                  {t.recentReviews.colIssues}
                </TableHead>
                <TableHead className="w-28 text-right">
                  {t.recentReviews.colDate}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.recentReviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell
                    className="max-w-[9rem] truncate font-medium"
                    title={review.reviewerName}
                  >
                    {review.reviewerName}
                  </TableCell>
                  <TableCell
                    className={cn(FLEX_CELL, "truncate font-mono text-xs text-muted-foreground")}
                    title={review.repositoryFullName}
                  >
                    {review.repositoryFullName}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {label.targetType[review.targetType]}
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

      <Section
        title={t.repositories.title}
        variant="raised"
        bleed
        action={{ label: messages.common.viewAll, href: repositoriesHref }}
      >
        {dashboard.repositories.length === 0 ? (
          <SectionEmpty>{t.repositories.empty}</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.repositories.colRepository}</TableHead>
                <TableHead className="w-24 text-right">
                  {t.repositories.colReviews}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t.repositories.colOpen}
                </TableHead>
                <TableHead className="w-32 text-right">
                  {t.repositories.colLastReview}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.repositories.map((repository) => (
                <TableRow key={repository.id}>
                  <TableCell
                    className={cn(FLEX_CELL, "truncate font-mono text-xs")}
                    title={repository.fullName}
                  >
                    {repository.fullName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {repository.reviewCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {repository.openIssueCount}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {repository.lastReviewAt === null
                      ? "—"
                      : formatDate(repository.lastReviewAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {/*
        🔴 Wiki 와 Resolution 을 **한 목록으로 합치지 않는다**(스펙 8).
        사람이 적은 것(Explicit)과 Review 가 남긴 것(Observed)은 출처가 다르다.
      */}
      <Section
        title={t.wiki.title}
        variant="raised"
        bleed
        action={{ label: messages.common.viewAll, href: wikiHref }}
      >
        {dashboard.knowledgePages.length === 0 ? (
          <SectionEmpty>{t.wiki.empty}</SectionEmpty>
        ) : (
          <ul className="divide-y divide-border/60 px-5">
            {dashboard.knowledgePages.map((page) => (
              <li
                key={page.slug}
                className="flex items-baseline gap-3 py-2 text-xs"
              >
                <Link
                  href={`${wikiHref}/${page.slug}` as Route}
                  className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline"
                >
                  {page.title}
                </Link>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                  {formatDate(page.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t.resolutions.title} variant="raised" bleed>
        {dashboard.recentResolutions.length === 0 ? (
          <SectionEmpty>{t.resolutions.empty}</SectionEmpty>
        ) : (
          <ul className="divide-y divide-border/60 px-5">
            {dashboard.recentResolutions.map((resolution) => (
              <li key={resolution.id} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-baseline gap-2">
                  <SeverityBadge severity={resolution.severity} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {resolution.title}
                  </span>
                  {resolution.patternKey !== null && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {resolution.patternKey}
                    </span>
                  )}
                  <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {formatDate(resolution.resolvedAt)}
                  </span>
                </div>
                <p className="line-clamp-2 text-[11px] text-muted-foreground">
                  {resolution.resolutionSummary}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageContainer>
  );
}
