import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, Boxes, ListChecks, Repeat2 } from "lucide-react";

import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { PageHeader } from "@/components/molecules/PageHeader";
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
 * 화면만 보고 세 질문에 답할 수 있어야 한다 —
 * **어느 Project 에 문제가 많은가 · 지금 먼저 볼 Issue 는 무엇인가 · 무엇이 반복되는가.**
 * 그래서 그 셋(Projects · Needs Attention · Frequent Patterns)을 올라온 표면에 둔다.
 *
 * 🔴 **Repository·Review·Issue 상세를 여기서 다 펼치지 않는다**(스펙 7). 각 줄은 한 층 아래로
 * 들어가는 **입구**다.
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-6 py-6">
      <PageHeader
        title={workspaceName}
        description="이 Workspace 전체의 Review 상태"
        actions={<CreateProjectDialog workspaceSlug={workspaceSlug} />}
      />

      <StatRow
        stats={[
          {
            label: "Reviews",
            value: dashboard.kpi.recentReviews,
            hint: "최근 30일",
            icon: ListChecks,
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
            hint: "현재 열려 있는 전체",
            tone: "attention",
          },
        ]}
      />

      <Section
        title="Projects"
        variant="raised"
        bleed
        action={{
          label: "전체 보기",
          href: sectionHref(workspaceSlug, "projects"),
        }}
      >
        {dashboard.projects.length === 0 ? (
          <SectionEmpty
            icon={<Boxes className="size-4" />}
            title="Project 가 없습니다"
          >
            Repository 는 Project 아래에 붙습니다. 제품·업무 단위로 하나 만드세요.
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
                    {/*
                      한 셀 안에 이름(주) 과 설명(보조)을 계층으로 둔다 —
                      열을 하나 더 만들면 표가 옆으로 길어지고 이름이 묻힌다.
                    */}
                    <Link
                      href={projectSectionHref(workspaceSlug, project.slug, "")}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.description !== null && (
                      <span className="mt-0.5 block max-w-md truncate text-xs font-normal text-muted-foreground">
                        {project.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {project.repositoryCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {project.reviewCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.openIssueCount > 0 ? (
                      <span className="font-medium text-foreground">
                        {project.openIssueCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
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

      <Section
        title="Needs Attention"
        description="급한 것부터, 같은 등급 안에서는 오래된 것부터"
        variant="raised"
        bleed
      >
        {dashboard.needsAttention.length === 0 ? (
          <SectionEmpty
            icon={<AlertTriangle className="size-4" />}
            title="열려 있는 Issue 가 없습니다"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-44">Project</TableHead>
                <TableHead className="w-20 text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.needsAttention.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <SeverityBadge severity={issue.severity} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={
                        `${projectSectionHref(workspaceSlug, issue.projectSlug, "issues")}?q=${encodeURIComponent(issue.title)}` as Route
                      }
                      className="block max-w-xl truncate font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                      {issue.category} · {issue.repositoryFullName}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {issue.projectName}
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

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Frequent Patterns"
          description="반복되는 문제"
          variant="raised"
          bleed
        >
          {dashboard.frequentPatterns.length === 0 ? (
            <SectionEmpty
              icon={<Repeat2 className="size-4" />}
              title="Pattern 이 없습니다"
            >
              Agent 가 Review 에 patternKey 를 함께 보내면 여기에 쌓입니다.
            </SectionEmpty>
          ) : (
            <ul className="divide-y divide-border/60">
              {dashboard.frequentPatterns.map((pattern) => (
                <li
                  key={`${pattern.patternKey}-${pattern.category}`}
                  className="flex items-center gap-3 px-5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-medium text-foreground">
                      {pattern.patternKey}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {pattern.category}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {pattern.occurrences}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      해결 {pattern.resolvedCount}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Recent Activity"
          description="Review 실행과 해결 기록"
          variant="raised"
          bleed
        >
          {dashboard.recentActivity.length === 0 ? (
            <SectionEmpty
              icon={<ListChecks className="size-4" />}
              title="활동이 없습니다"
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {dashboard.recentActivity.map((entry) => (
                <li
                  key={`${entry.kind}-${entry.id}`}
                  className="flex items-start gap-3 px-5 py-2.5"
                >
                  {/*
                    🔴 종류를 Badge 로 만들지 않는다 — 점 하나로 충분하다.
                    색은 «의미»에만 쓴다: 해결은 브랜드색, 검토는 중립.
                  */}
                  <span
                    aria-hidden
                    className={
                      entry.kind === "RESOLUTION"
                        ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                        : "mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-foreground">
                      {entry.kind === "REVIEW" ? (
                        <>
                          <span className="font-medium">
                            {entry.reviewerName}
                          </span>
                          <span className="text-muted-foreground">
                            {" 가 "}
                            {entry.repositoryFullName} 검토 — Issue{" "}
                            {entry.issueCount}건
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{entry.title}</span>
                          <span className="text-muted-foreground">
                            {" 해결 — "}
                            {entry.repositoryFullName}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {entry.projectName} · {formatDate(entry.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
