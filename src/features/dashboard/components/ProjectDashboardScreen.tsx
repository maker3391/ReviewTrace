import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { Timestamp } from "@/components/atoms/Timestamp";
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
import { PageContainer } from "@/components/molecules/PageContainer";
import { PageHeader } from "@/components/molecules/PageHeader";
import { projectSectionHref } from "@/config/navigation";
import { findProjectDashboard } from "@/features/dashboard/server/project-dashboard-query";
import type { ProjectContext } from "@/features/projects/types/project";
/*
 🔴 **Dashboard -> Feature 한 방향이다**. Review 표의 «폭 계약»과 「무엇을
 봤는가」의 표기 규칙을 여기에 다시 적지 않고 주인 Feature 것을 불러 쓴다 — 두 곳에 적으면
 한쪽만 고쳐져 같은 값이 두 화면에서 다르게 그려진다(실제로 그랬다).
*/
import { ReviewTargetCell } from "@/features/reviews/components/ReviewTargetCell";
import {
  REVIEW_COL,
  REVIEW_TABLE,
} from "@/features/reviews/components/review-table-columns";
import { formatAgeInDays } from "@/lib/format/date";
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
  const reviewsHref = projectSectionHref(
    workspaceSlug,
    project.slug,
    "reviews",
  );
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

      {/*
 🔴 넷을 각각 큰 카드로 떼어 놓지 않는다 — 한 표면 안에서 세로선으로 나눈다
. 여기서 손댄 것은 **무게**뿐이다:

 - 「미해결」은 쌓이면 안 되는 값이라 `attention` — Workspace Dashboard 가 이미 같은
 판단을 하고 있어 두 화면의 같은 지표가 같게 읽힌다. 0 이면 색이 붙지 않는다
 - 「해결률」은 `"40%"` 라는 **문자열**이라 날짜 취급을 받아 넷 중 가장 «작게»
 그려졌다. 숫자와 단위를 갈라 넘겨 다시 지표로 읽히게 한다
 */}
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
            tone: "attention",
          },
          {
            label: t.kpiResolutionRate,
            value: dashboard.kpi.resolutionRate,
            unit: "%",
            hint: t.hintFoundLast30Days,
          },
        ]}
      />

      {/*
 🔴 **여섯 Section 중 이것 하나만 `emphasis` 다.** 「지금 무엇을 해야 하는가」에
 답하는 유일한 영역이라 스크롤에서 먼저 걸려야 한다. 강조는 테두리·그림자·제목
 크기를 한 단계씩 올리는 것까지고, **색도 배경도 더하지 않는다** — 나머지 다섯은
 지금 그대로 조용한 보조 정보로 남는다.
 */}
      <Section
        title={t.openIssues.title}
        variant="raised"
        emphasis
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
                {/*
 🔴 **좁은 폭에서는 접는다.** 이 칸은 `max-w-[14rem]`(224px) 이 «바닥이자
 천장»이라 컨테이너가 아무리 좁아져도 224px 을 그대로 물고 있었다 — 390 에서
 표가 203px, 768 에서 33px 가로로 넘친 원인이다. 그 폭에서 이미 제목 칸은
 바닥(128px)에 닿아 있어, 자리를 더 내줄 곳은 여기뿐이다.
 Issue 목록이 Location 을 `lg` 아래에서 접는 것과 같은 판단이고, 접힌 값은
 Issue 상세에 그대로 있다.
 */}
                <TableHead className="hidden w-56 lg:table-cell">
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
                  <TableCell className="hidden max-w-[14rem] overflow-hidden lg:table-cell">
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
              {/*
 🔴 **좁은 폭에서는 «무엇이 반복되는가»와 「몇 번」만 남긴다.**
 머리글이 긴 영어(`OCCURRENCES` 110px · `CATEGORY` 120px · `LAST SEEN` 92px)
 에서 다섯 열의 자연 폭이 532px 이라, 390(컨테이너 277px)에서 표가 255px
 가로로 넘쳤다. 분류와 최근 시각을 접으면 320px 이 된다 — 접힌 값은 Issue
 목록과 상세에 그대로 있다(Issue·Review 목록과 같은 방식).
 */}
              <TableRow>
                <TableHead>{t.patterns.colPattern}</TableHead>
                <TableHead className="hidden w-44 lg:table-cell">
                  {t.patterns.colCategory}
                </TableHead>
                {/*
 🔴 **「발생」이 아니라 「문제」다.** 이 칸은 이제 고유 Issue 수라 옆의 「해결」과
 같은 단위이고, 재발까지 센 횟수는 셀 안의 보조 줄로 내려간다 — 열을 하나 더
 만들면 이미 390px 에서 아슬아슬한 이 표가 다시 넘친다.
 */}
                <TableHead className="w-24 text-right">
                  {t.patterns.colIssues}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t.patterns.colResolved}
                </TableHead>
                <TableHead className="hidden w-32 text-right sm:table-cell">
                  {t.patterns.colLast}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.frequentPatterns.map((pattern) => (
                <TableRow key={`${pattern.patternKey}-${pattern.category}`}>
                  {/*
 🔴 **식별자 칸에는 바닥이 있어야 한다**(`ui/table.tsx` 의 `NAME_CELL`).
 `FLEX_CELL` 만 걸려 있어 390 에서 이 칸이 **74px** 로 뭉개졌다 —
 `MISSING_VALIDATION` 이 두 글자만 남는 폭이다.
 */}
                  <TableCell
                    className={cn(
                      NAME_CELL,
                      "truncate font-mono text-xs font-medium",
                    )}
                    title={pattern.patternKey}
                  >
                    {pattern.patternKey}
                  </TableCell>
                  <TableCell className="hidden text-[11px] text-muted-foreground lg:table-cell">
                    {label.category[pattern.category]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pattern.uniqueIssues}
                    {pattern.encounters > pattern.uniqueIssues && (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {t.patterns.encounters(pattern.encounters)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {pattern.resolvedCount}
                  </TableCell>
                  <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                    <Timestamp
                      value={pattern.lastDetectedAt}
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

      <Section
        title={t.recentReviews.title}
        variant="raised"
        bleed
        action={{ label: messages.common.viewAll, href: reviewsHref }}
      >
        {dashboard.recentReviews.length === 0 ? (
          <SectionEmpty>{t.recentReviews.empty}</SectionEmpty>
        ) : (
          /*
 🔴 **Review 목록 화면과 «같은» 폭 계약을 쓴다**
 (`features/reviews/components/review-table-columns.ts`).

 여기는 그 파일이 고쳐 둔 고장을 그대로 갖고 있었다 — `table-auto` 에 대상 칸을
 `w-56` 으로 «적어» 두었는데 그것은 요구일 뿐이라, 끊을 자리가 없는
 `Branch · feature/very/deeply/nested/… · a81f3c2` 한 줄이 그 칸을 **어느
 폭에서나 770px** 로 굳혔다. 실측한 결과:

 ```
 컨테이너 표 넘침 대상 저장소
 1440 1103 1164 +61 770 94
 1024 703 1164 +461 770 94
 768 447 1164 +717 770 94
 390 277 1164 +887 770 94
 ```

 1440 에서도 날짜 칸이 화면 밖으로 밀려 `2026-` 까지만 보였다. `table-fixed` 는
 폭을 머리 행이 정하고 내용이 그 안에서 잘리므로 값이 아무리 길어도 표가
 넓어지지 않는다.
 */
          <Table className={REVIEW_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className={REVIEW_COL.reviewer}>
                  {t.recentReviews.colReviewer}
                </TableHead>
                <TableHead className={REVIEW_COL.repository}>
                  {t.recentReviews.colRepository}
                </TableHead>
                <TableHead className={REVIEW_COL.target}>
                  {t.recentReviews.colTarget}
                </TableHead>
                <TableHead className={REVIEW_COL.issues}>
                  {t.recentReviews.colIssues}
                </TableHead>
                <TableHead className={REVIEW_COL.date}>
                  {t.recentReviews.colDate}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.recentReviews.map((review) => {
                return (
                  <TableRow key={review.id}>
                    <TableCell
                      className={cn(
                        REVIEW_COL.reviewer,
                        "truncate font-medium",
                      )}
                      title={review.reviewerName}
                    >
                      {review.reviewerName}
                    </TableCell>
                    <TableCell
                      className={cn(
                        REVIEW_COL.repository,
                        "truncate font-mono text-xs text-muted-foreground",
                      )}
                      title={review.repositoryFullName}
                    >
                      {review.repositoryFullName}
                    </TableCell>
                    {/*
 🔴 **그리는 자리까지 주인 Feature 것을 쓴다.** 예전에는 규칙(`describeTarget`)만
 공유하고 markup 은 두 화면에 복사돼 있었다 — 한쪽만 고치면 같은 값이 다르게 보인다.
 */}
                    <ReviewTargetCell
                      review={review}
                      typeLabel={label.targetType[review.targetType]}
                    />
                    <TableCell
                      className={cn(REVIEW_COL.issues, "tabular-nums")}
                    >
                      {review.issueCount}
                    </TableCell>
                    <TableCell
                      className={cn(
                        REVIEW_COL.date,
                        "text-xs tabular-nums text-muted-foreground",
                      )}
                    >
                      <Timestamp
                        value={review.createdAt}
                        variant="relative"
                        now={now}
                        locale={locale}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
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
                {/*
 🔴 저장소 «이름»의 바닥(128px)을 지키려면 좁은 폭에서 내줄 것이 필요하다.
 가장 덜 급한 것은 날짜다 — 「어느 저장소를 봐야 하는가」는 이름과 미해결
 건수가 답한다. 전체 값은 Repositories 목록·상세에 있다.
 */}
                <TableHead className="hidden w-32 text-right sm:table-cell">
                  {t.repositories.colLastReview}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.repositories.map((repository) => (
                <TableRow key={repository.id}>
                  {/*
 Repositories 목록 화면과 같은 바닥을 쓴다 — 그쪽은 `NAME_CELL` 인데
 여기만 `FLEX_CELL` 이라 390 에서 저장소 이름 칸이 **94px** 였다.
 */}
                  <TableCell
                    className={cn(NAME_CELL, "truncate font-mono text-xs")}
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
                  <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                    <Timestamp
                      value={repository.lastReviewAt}
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
                {/*
 🔴 잘리는 값에는 «전문을 볼 방법»을 함께 둔다. 문서 제목은 공백이 하나도
 없을 수 있어(실제 fixture: 78자 한 낱말) 잘린 앞부분만으로는 어느 문서인지
 가려지지 않는다.
 */}
                <Link
                  href={`${wikiHref}/${page.slug}` as Route}
                  title={page.title}
                  className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline"
                >
                  {page.title}
                </Link>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                  <Timestamp
                    value={page.updatedAt}
                    variant="relative"
                    now={now}
                    locale={locale}
                  />
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
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium"
                    title={resolution.title}
                  >
                    {resolution.title}
                  </span>
                  {/*
 🔴 **`shrink-0` 에 상한이 없으면 그 낱말이 줄을 밀어낸다.** Pattern Key 는
 빈칸이 없는 식별자라 90자짜리 하나가 줄 전체를 넘겼다 — 390 에서 목록이
 **335px**, 768 에서 **165px** 가로로 넘쳤고 그 행만 높이가 72px(다른 행은
 56px)이 됐다. 좁은 폭에서는 접고, 그 위에서는 제 폭 안에서 자른다:
 이 줄에서 «행을 알아보는 값»은 제목이지 Pattern Key 가 아니다.
 */}
                  {resolution.patternKey !== null && (
                    <span
                      className="hidden max-w-[12rem] shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:block"
                      title={resolution.patternKey}
                    >
                      {resolution.patternKey}
                    </span>
                  )}
                  <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    <Timestamp
                      value={resolution.resolvedAt}
                      variant="relative"
                      now={now}
                      locale={locale}
                    />
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
