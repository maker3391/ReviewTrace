import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, Boxes, ListChecks, Repeat2 } from "lucide-react";

import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { Timestamp } from "@/components/atoms/Timestamp";
import { PageContainer } from "@/components/molecules/PageContainer";
import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { StatRow } from "@/components/molecules/StatRow";
import {
  NAME_CELL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { projectSectionHref, sectionHref } from "@/config/navigation";
import { findWorkspaceDashboard } from "@/features/dashboard/server/workspace-dashboard-query";
import { CreateProjectButton } from "@/features/projects/components/CreateProjectButton";
import { formatAgeInDays } from "@/lib/format/date";
import { readLocale, readMessages } from "@/lib/ui/appearance";

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
  /** 🔴 소속 확인을 통과한 값. URL 의 slug 를 그대로 넣지 않는다. */
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}) {
  const [dashboard, locale, messages] = await Promise.all([
    findWorkspaceDashboard(workspaceId),
    readLocale(),
    readMessages(),
  ]);
  const t = messages.workspaceDashboard;
  const label = messages.enums;
  // 🔴 「며칠째인가」의 기준 시각을 한 번만 정한다. 줄마다 now() 를 부르면 값이 갈린다.
  const now = new Date();

  return (
    <PageContainer width="wide" className="gap-7">
      {/*
 🔴 제목 아래에 「이 Workspace 전체의 Review 상태」 같은 줄을 두지 않는다 —
 바로 아래 KPI 줄이 그 말을 «숫자로» 하고 있다.
 */}
      <PageHeader
        title={workspaceName}
        actions={<CreateProjectButton workspaceSlug={workspaceSlug} />}
      />

      <StatRow
        stats={[
          {
            label: t.kpiReviews,
            value: dashboard.kpi.recentReviews,
            hint: t.hintLast30Days,
            icon: ListChecks,
          },
          {
            label: t.kpiIssuesFound,
            value: dashboard.kpi.recentIssuesFound,
            hint: t.hintLast30Days,
          },
          {
            label: t.kpiResolved,
            value: dashboard.kpi.recentResolvedIssues,
            hint: t.hintLast30Days,
          },
          {
            label: t.kpiOpen,
            value: dashboard.kpi.openIssues,
            hint: t.hintOpenNow,
            tone: "attention",
          },
        ]}
      />

      <Section
        title={t.projects.title}
        variant="raised"
        bleed
        action={{
          label: messages.common.viewAll,
          href: sectionHref(workspaceSlug, "projects"),
        }}
      >
        {dashboard.projects.length === 0 ? (
          <SectionEmpty
            icon={<Boxes className="size-4" />}
            title={t.projects.empty}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.projects.colProject}</TableHead>
                <TableHead className="w-28 text-right">
                  {t.projects.colRepositories}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t.projects.colReviews}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t.projects.colOpen}
                </TableHead>
                <TableHead className="w-32 text-right">
                  {t.projects.colLastActivity}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.projects.map((project) => (
                <TableRow key={project.projectId}>
                  <TableCell className={NAME_CELL}>
                    {/*
 한 셀 안에 이름(주) 과 설명(보조)을 계층으로 둔다 —
 열을 하나 더 만들면 표가 옆으로 길어지고 이름이 묻힌다.
 */}
                    <Link
                      href={projectSectionHref(workspaceSlug, project.slug, "")}
                      title={project.name}
                      className="block truncate font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.description !== null && (
                      <span
                        className="mt-0.5 block truncate text-xs font-normal text-muted-foreground"
                        title={project.description}
                      >
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
                    <Timestamp
                      value={project.lastActivityAt}
                      variant="relative"
                      now={now}
                      locale={locale}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {/*
 🔴 정렬 규칙(「급한 것부터, 같은 등급 안에서는 오래된 것부터」)을 설명 줄로 적지
 않는다. Severity 와 Age 열이 그 순서를 «보여 주고» 있어, 매번 읽고 지나가야 하는
 한 줄만 는다.
 */}
      <Section title={t.needsAttention.title} variant="raised" bleed>
        {dashboard.needsAttention.length === 0 ? (
          <SectionEmpty
            icon={<AlertTriangle className="size-4" />}
            title={t.needsAttention.empty}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  {t.needsAttention.colSeverity}
                </TableHead>
                <TableHead>{t.needsAttention.colIssue}</TableHead>
                <TableHead className="w-44">
                  {t.needsAttention.colProject}
                </TableHead>
                <TableHead className="w-20 text-right">
                  {t.needsAttention.colAge}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.needsAttention.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <SeverityBadge severity={issue.severity} />
                  </TableCell>
                  <TableCell className={NAME_CELL}>
                    {/*
 🔴 **제목은 그 Issue 상세로 «바로» 간다.** 예전에는 제목을 검색어로 실어
 Issue 목록(`?q=`)으로 보냈다 — 고른 줄이 아니라 「제목이 비슷한 것들」이
 나오고, 같은 제목이 둘이면 어느 것인지 사람이 다시 골라야 했다.
 id 는 이미 이 줄이 들고 있다.
 */}
                    <Link
                      href={
                        `${projectSectionHref(workspaceSlug, issue.projectSlug, "issues")}/${issue.id}` as Route
                      }
                      title={issue.title}
                      className="block truncate font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span
                      className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                      title={`${label.category[issue.category]} · ${issue.repositoryFullName}`}
                    >
                      {label.category[issue.category]} ·{" "}
                      <span className="font-mono">
                        {issue.repositoryFullName}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell
                    className="max-w-[11rem] truncate text-xs text-muted-foreground"
                    title={issue.projectName}
                  >
                    {issue.projectName}
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

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t.patterns.title} variant="raised" bleed>
          {dashboard.frequentPatterns.length === 0 ? (
            <SectionEmpty
              icon={<Repeat2 className="size-4" />}
              title={t.patterns.empty}
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {dashboard.frequentPatterns.map((pattern) => (
                <li
                  key={`${pattern.patternKey}-${pattern.category}`}
                  className="flex items-center gap-3 px-5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate font-mono text-xs font-medium text-foreground"
                      title={pattern.patternKey}
                    >
                      {pattern.patternKey}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {label.category[pattern.category]}
                    </p>
                  </div>
                  {/*
 🔴 **비교되는 두 숫자는 같은 단위여야 한다.** 큰 숫자를 encounter 로 두고 그 아래
 「해결 3」을 적으면 「8건 중 3건 해결」로 읽히는데, 8 은 재발까지 센 «횟수»라
 3 과 같은 모집단이 아니다. 그래서 위에는 고유 Issue 수를 두어 「해결」과 짝을
 맞추고, 반복 횟수는 낱말을 달아 옆에 둔다.
 */}
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {pattern.uniqueIssues}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {t.patterns.resolved(pattern.resolvedCount)}
                      {pattern.encounters > pattern.uniqueIssues && (
                        <>
                          <span aria-hidden className="mx-1 text-border">
                            ·
                          </span>
                          {t.patterns.encounters(pattern.encounters)}
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t.activity.title} variant="raised" bleed>
          {dashboard.recentActivity.length === 0 ? (
            <SectionEmpty
              icon={<ListChecks className="size-4" />}
              title={t.activity.empty}
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
                    {/*
 🔴 **누를 수 있는 것은 «그 줄을 알아보는 이름» 하나뿐이다.** 뒤따르는 저장소·
 건수는 설명이지 목적지가 아니고, 줄 전체를 누르게 만들면 앞으로 이 줄에 다른
 action 이 붙는 순간 클릭 영역이 겹친다.

 🔴 **해결된 Issue 도 예외가 아니다** — RESOLVED 라고 다른 곳으로 보내지 않고
 그 Issue 상세로 간다. Activity 행의 `id` 가 아니라 `issueId` 를 쓴다.
 */}
                    <p className="truncate text-xs text-foreground">
                      {entry.kind === "REVIEW" ? (
                        <>
                          <Link
                            href={
                              `${projectSectionHref(workspaceSlug, entry.projectSlug, "reviews")}/${entry.id}` as Route
                            }
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {entry.reviewerName}
                          </Link>
                          <span className="text-muted-foreground">
                            {t.activity.reviewSuffix(
                              entry.repositoryFullName,
                              entry.issueCount,
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <Link
                            href={
                              `${projectSectionHref(workspaceSlug, entry.projectSlug, "issues")}/${entry.issueId}` as Route
                            }
                            title={entry.title}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {entry.title}
                          </Link>
                          <span className="text-muted-foreground">
                            {t.activity.resolutionSuffix(
                              entry.repositoryFullName,
                            )}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {entry.projectName} ·{" "}
                      <Timestamp
                        value={entry.at}
                        variant="relative"
                        now={now}
                        locale={locale}
                      />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </PageContainer>
  );
}
