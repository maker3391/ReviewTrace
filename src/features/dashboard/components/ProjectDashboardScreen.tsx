import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
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
import { projectSectionHref } from "@/config/navigation";
import { findProjectDashboard } from "@/features/dashboard/server/project-dashboard-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatAgeInDays, formatDate } from "@/lib/format/date";

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
  const dashboard = await findProjectDashboard({
    workspaceId,
    projectId: project.projectId,
  });
  const now = new Date();

  const issuesHref = projectSectionHref(workspaceSlug, project.slug, "issues");
  const reviewsHref = projectSectionHref(workspaceSlug, project.slug, "reviews");
  const knowledgeHref = projectSectionHref(
    workspaceSlug,
    project.slug,
    "knowledge",
  );
  const repositoriesHref = projectSectionHref(
    workspaceSlug,
    project.slug,
    "repositories",
  );

  return (
    <div className="flex flex-col gap-8 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
        {project.description !== null && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {project.description}
          </p>
        )}
      </header>

      <Section title="Overview">
        <div className="pt-4">
          <StatRow
            stats={[
              {
                label: "Reviews",
                value: dashboard.kpi.recentReviews,
                hint: "최근 30일",
              },
              {
                label: "Issues",
                value: dashboard.kpi.recentIssuesFound,
                hint: "최근 30일",
              },
              { label: "Open", value: dashboard.kpi.openIssues, hint: "현재" },
              {
                label: "Resolution Rate",
                value:
                  dashboard.kpi.resolutionRate === null
                    ? null
                    : `${dashboard.kpi.resolutionRate}%`,
                hint: "최근 30일 발견분",
              },
            ]}
          />
        </div>
      </Section>

      <Section title="Open Issues" action={{ label: "전체 보기", href: issuesHref }}>
        {dashboard.openIssues.length === 0 ? (
          <SectionEmpty>열려 있는 Issue 가 없습니다.</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-56">Repository · Location</TableHead>
                <TableHead className="w-20 text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.openIssues.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <SeverityBadge severity={issue.severity} />
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{issue.title}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {issue.category}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {issue.repositoryFullName}
                    </span>
                    <CodeLocation filePath={issue.filePath} />
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

      <Section title="Frequent Patterns">
        {dashboard.frequentPatterns.length === 0 ? (
          <SectionEmpty>Pattern 이 없습니다.</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pattern</TableHead>
                <TableHead className="w-44">Category</TableHead>
                <TableHead className="w-24 text-right">발생</TableHead>
                <TableHead className="w-24 text-right">해결</TableHead>
                <TableHead className="w-32 text-right">최근</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.frequentPatterns.map((pattern) => (
                <TableRow key={`${pattern.patternKey}-${pattern.category}`}>
                  <TableCell className="font-mono text-xs font-medium">
                    {pattern.patternKey}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {pattern.category}
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
        title="Recent Reviews"
        action={{ label: "전체 보기", href: reviewsHref }}
      >
        {dashboard.recentReviews.length === 0 ? (
          <SectionEmpty>Review 가 없습니다.</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Reviewer</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead className="w-56">Target</TableHead>
                <TableHead className="w-20 text-right">Issues</TableHead>
                <TableHead className="w-28 text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.recentReviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell className="font-medium">
                    {review.reviewerName}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {review.repositoryFullName}
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

      <Section
        title="Repositories"
        action={{ label: "전체 보기", href: repositoriesHref }}
      >
        {dashboard.repositories.length === 0 ? (
          <SectionEmpty>
            Repository 가 없습니다. Agent 가 Review 를 보내면 등록됩니다.
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead className="w-24 text-right">Reviews</TableHead>
                <TableHead className="w-24 text-right">Open</TableHead>
                <TableHead className="w-32 text-right">최근 Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.repositories.map((repository) => (
                <TableRow key={repository.id}>
                  <TableCell className="font-mono text-xs">
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
        title="Knowledge"
        description="사람이 적은 문서"
        action={{ label: "전체 보기", href: knowledgeHref }}
      >
        {dashboard.knowledgePages.length === 0 ? (
          <SectionEmpty>문서가 없습니다.</SectionEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {dashboard.knowledgePages.map((page) => (
              <li
                key={page.slug}
                className="flex items-baseline gap-3 py-2 text-xs"
              >
                <Link
                  href={`${knowledgeHref}/${page.slug}` as Route}
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

      <Section title="Recent Resolutions" description="Review 가 남긴 해결 기록">
        {dashboard.recentResolutions.length === 0 ? (
          <SectionEmpty>해결 기록이 없습니다.</SectionEmpty>
        ) : (
          <ul className="divide-y divide-border">
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
    </div>
  );
}
