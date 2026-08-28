import Link from "next/link";
import type { Route } from "next";

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
import { projectSectionHref, sectionHref } from "@/config/navigation";
import { findWorkspaceDashboard } from "@/features/dashboard/server/workspace-dashboard-query";
import { CreateProjectDialog } from "@/features/projects/components/CreateProjectDialog";
import { formatAgeInDays, formatDate } from "@/lib/format/date";

/**
 * Workspace Dashboard(스펙 5).
 *
 * **「이 Workspace 전체에서 지금 어디를 봐야 하는가?」** 에 답한다.
 *
 * 🔴 **Repository·Review·Issue 상세를 여기서 다 펼치지 않는다**(스펙 7). 각 줄은 한 층 아래로
 * 들어가는 **입구**다.
 *
 * 🔴 **Card Gallery 로 만들지 않는다**(CLAUDE.md 16). 영역은 제목과 divider 로 나누고,
 * KPI 는 숫자와 정렬로 비교하게 둔다 — 화면의 주인공은 Component 가 아니라 데이터다.
 */
export async function WorkspaceDashboardScreen({
  workspaceId,
  workspaceSlug,
  workspaceName,
}: {
  /** 🔴 소속 확인을 통과한 값. URL 의 slug 를 그대로 넣지 않는다(CLAUDE.md 11). */
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}) {
  const dashboard = await findWorkspaceDashboard(workspaceId);
  // 🔴 「며칠째인가」의 기준 시각을 한 번만 정한다. 줄마다 now() 를 부르면 값이 갈린다.
  const now = new Date();

  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{workspaceName}</h1>
        <CreateProjectDialog workspaceSlug={workspaceSlug} />
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
                label: "Issues Found",
                value: dashboard.kpi.recentIssuesFound,
                hint: "최근 30일",
              },
              {
                label: "Resolved",
                value: dashboard.kpi.recentResolvedIssues,
                hint: "최근 30일",
              },
              {
                label: "Open",
                value: dashboard.kpi.openIssues,
                hint: "현재",
              },
            ]}
          />
        </div>
      </Section>

      <Section
        title="Projects"
        action={{
          label: "전체 보기",
          href: sectionHref(workspaceSlug, "projects"),
        }}
      >
        {dashboard.projects.length === 0 ? (
          <SectionEmpty>
            Project 가 없습니다. Repository 는 Project 아래에 붙습니다.
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="w-28 text-right">Repositories</TableHead>
                <TableHead className="w-24 text-right">Reviews</TableHead>
                <TableHead className="w-24 text-right">Open</TableHead>
                <TableHead className="w-32 text-right">최근 활동</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.projects.map((project) => (
                <TableRow key={project.projectId}>
                  <TableCell>
                    <Link
                      href={projectSectionHref(workspaceSlug, project.slug, "")}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.repositoryCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.reviewCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.openIssueCount}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {project.lastActivityAt === null
                      ? "—"
                      : formatDate(project.lastActivityAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Needs Attention">
        {dashboard.needsAttention.length === 0 ? (
          <SectionEmpty>열려 있는 Issue 가 없습니다.</SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead className="w-40">Project</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-44">Repository</TableHead>
                <TableHead className="w-20 text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.needsAttention.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <SeverityBadge severity={issue.severity} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {issue.projectName}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={
                        `${projectSectionHref(workspaceSlug, issue.projectSlug, "issues")}?q=${encodeURIComponent(issue.title)}` as Route
                      }
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {issue.category}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {issue.repositoryFullName}
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
          <SectionEmpty>
            Pattern 이 없습니다. Agent 가 patternKey 를 함께 보내면 쌓입니다.
          </SectionEmpty>
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

      <Section title="Recent Activity">
        {dashboard.recentActivity.length === 0 ? (
          <SectionEmpty>활동이 없습니다.</SectionEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {dashboard.recentActivity.map((entry) => (
              <li
                key={`${entry.kind}-${entry.id}`}
                className="flex items-baseline gap-3 py-2 text-xs"
              >
                <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                  {entry.kind === "REVIEW" ? "review" : "resolved"}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.kind === "REVIEW" ? (
                    <>
                      <span className="font-medium">{entry.reviewerName}</span>
                      <span className="text-muted-foreground">
                        {" 가 "}
                        {entry.repositoryFullName} 검토 — Issue {entry.issueCount}건
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{entry.title}</span>
                      <span className="text-muted-foreground">
                        {" — "}
                        {entry.repositoryFullName}
                      </span>
                    </>
                  )}
                </span>
                <span className="w-32 shrink-0 truncate text-right text-muted-foreground">
                  {entry.projectName}
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                  {formatDate(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
