import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { MetaDot, PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import {
  readProjectSlugFromPath,
  readWorkspaceSlugFromPath,
} from "@/config/routes";
import { IssueActivityForm } from "@/features/issues/components/IssueActivityForm";
import { IssueStatusControl } from "@/features/issues/components/IssueStatusControl";
import type {
  IssueActivityEntry,
  IssueDetail,
} from "@/features/issues/server/issue-detail-query";
import { formatDate } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * ReviewIssue 상세.
 *
 * 화면의 주인공은 **History** 다(CLAUDE.md 2). 「무슨 문제인가」보다 **「어떻게 여기까지
 * 왔는가」** 가 Knowledge 이기 때문이다.
 *
 * ## 왜 두 단인가
 *
 * 🔴 **읽는 것과 하는 것을 나눈다.** 한 단으로 늘어놓으면 「제목 + 구분선」이 끝없이 이어져
 * 무엇이 본문이고 무엇이 도구인지 구분되지 않는다(CLAUDE.md 16).
 *
 * ```
 * ┌ 본문(넓게) ─────────────┐ ┌ 곁 정보(좁게) ┐
 * │ 설명 · 제안 · Resolution │ │ 상태 변경      │
 * │ History                 │ │ 위치 · 식별    │
 * └─────────────────────────┘ └───────────────┘
 * ```
 *
 * 🔴 **`suggestion` 과 `resolutionSummary` 를 한 칸에 섞지 않는다.**
 * 앞은 Agent 가 「해 보라」고 한 것이고 뒤는 「했다」의 기록이다.
 *
 * 상태 전이와 기록 남기기는 사용자 입력이 있는 폼이라 그 자리에서만 Client Component 로
 * 내려간다(CLAUDE.md 7). 이 화면 자체는 Server Component 로 남는다.
 */
export function IssueDetailScreen({
  issue,
  reviewsPath,
  repositoriesPath,
}: {
  issue: IssueDetail;
  /** Review 상세로 가는 주소의 뿌리. */
  reviewsPath: Route;
  repositoriesPath: Route;
}) {
  /*
    Server Action 에 되돌려 줄 주소의 slug.

    🔴 **이 값들은 권한 근거가 아니다**(`src/config/routes.ts`). Server Action 이
    `requireProject` 로 소속을 다시 확인하고, 확인된 `workspaceId` 로만 Issue 를 찾는다 —
    주소를 남의 Workspace 로 바꿔 보내도 조회 자체가 비어서 돌아온다(CLAUDE.md 11).
    여기서 하는 일은 「지금 어느 주소의 화면인가」를 그대로 서버에 되돌려 주는 것뿐이다.
  */
  const workspaceSlug = readWorkspaceSlugFromPath(reviewsPath);
  const projectSlug = readProjectSlugFromPath(reviewsPath);
  const canAct = workspaceSlug !== null && projectSlug !== null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title={issue.title}
        titleAdornment={
          <span className="flex items-center gap-1.5">
            <SeverityBadge severity={issue.severity} />
            <StatusBadge status={issue.status} />
          </span>
        }
        meta={
          <>
            <Link
              href={`${repositoriesPath}/${issue.repositoryId}` as Route}
              className="font-mono underline-offset-4 hover:text-foreground hover:underline"
            >
              {issue.repositoryFullName}
            </Link>
            <MetaDot />
            <span className="font-mono">{issue.category}</span>
            {issue.patternKey !== null && (
              <>
                <MetaDot />
                <span className="font-mono">{issue.patternKey}</span>
              </>
            )}
            <MetaDot />
            <span>발견 {formatDate(issue.firstDetectedAt)}</span>
            {issue.resolvedAt !== null && (
              <>
                <MetaDot />
                <span>해결 {formatDate(issue.resolvedAt)}</span>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── 본문 ─────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-5">
          {issue.description !== null && (
            <Section title="설명" variant="raised">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {issue.description}
              </p>
            </Section>
          )}

          {issue.suggestion !== null && (
            <Section
              title="제안"
              description="Agent 가 「해 보라」고 한 것"
              variant="raised"
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {issue.suggestion}
              </p>
            </Section>
          )}

          {issue.resolutionSummary !== null && (
            <Section
              title="Resolution"
              description="실제로 「했다」의 기록"
              variant="raised"
            >
              {/*
                해결 기록만 브랜드 톤을 얹는다 — 이 화면에서 가장 값진 한 칸이기 때문이다.
                🔴 색은 의미에만 쓴다(CLAUDE.md 16).
              */}
              <p className="whitespace-pre-wrap border-l-2 border-primary/40 bg-primary/[0.03] py-1 pl-3 text-sm leading-relaxed text-foreground">
                {issue.resolutionSummary}
              </p>
            </Section>
          )}

          <Section
            title="History"
            description="Detection → Fix → Re-review → Resolution"
            variant="raised"
          >
            {issue.activities.length === 0 ? (
              <SectionEmpty title="기록이 없습니다" />
            ) : (
              <ol className="flex flex-col">
                {issue.activities.map((activity, index) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    last={index === issue.activities.length - 1}
                  />
                ))}
              </ol>
            )}

            {canAct && (
              <div className="mt-4 border-t border-border/70 pt-4">
                <IssueActivityForm
                  workspaceSlug={workspaceSlug}
                  projectSlug={projectSlug}
                  issueId={issue.id}
                />
              </div>
            )}
          </Section>
        </div>

        {/* ── 곁 정보 ───────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-5">
          {canAct && (
            <Section title="상태" variant="raised">
              <IssueStatusControl
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                issueId={issue.id}
                currentStatus={issue.status}
                currentResolutionSummary={issue.resolutionSummary}
              />
            </Section>
          )}

          <Section title="위치" variant="raised">
            <CodeLocation
              filePath={issue.filePath}
              lineStart={issue.startLine}
              lineEnd={issue.endLine}
              className="break-all"
            />
          </Section>

          <Section title="식별" variant="raised">
            <dl className="flex flex-col gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Tags</dt>
                <dd className="mt-1">
                  {issue.tags.length === 0 ? (
                    <span className="text-muted-foreground/70">—</span>
                  ) : (
                    /*
                      🔴 Tag 를 Badge 로 만들지 않는다 — Badge 는 상태·분류의 자리다
                      (CLAUDE.md 16). Tag 는 검색용 Keyword 라 옅은 칩이면 충분하다.
                    */
                    <span className="flex flex-wrap gap-1">
                      {issue.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">처음 본 Review</dt>
                <dd className="mt-1">
                  <Link
                    href={`${reviewsPath}/${issue.reviewSessionId}` as Route}
                    className="underline-offset-4 hover:underline"
                  >
                    {issue.reviewerName}
                  </Link>
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="mt-1 font-mono break-all">
                  {issue.source === null && issue.externalId === null
                    ? "—"
                    : `${issue.source ?? "?"} / ${issue.externalId ?? "?"}`}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">마지막 변경</dt>
                <dd className="mt-1 tabular-nums">
                  {formatDate(issue.updatedAt)}
                </dd>
              </div>
            </dl>
          </Section>
        </aside>
      </div>
    </div>
  );
}

/**
 * History 한 줄.
 *
 * 🔴 **모든 값을 Badge 로 만들지 않는다**(CLAUDE.md 16). 시각적으로 구분하는 것은
 * **Activity Type 하나**뿐이고, 행위자·설명·Commit·시각은 Text 계층으로 읽힌다.
 *
 * 왼쪽 세로선과 점이 「한 줄기로 이어진 History」를 만든다 — Agent 작업 로그가 아니라
 * 「이 Issue 가 어떻게 해결됐는가」로 읽혀야 한다.
 */
function ActivityRow({
  activity,
  last,
}: {
  activity: IssueActivityEntry;
  last: boolean;
}) {
  // 해결로 끝난 것만 브랜드 톤. 나머지는 중립이다 — 색을 의미에만 쓴다.
  const resolved = activity.type === "RESOLVED";

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full ring-2 ring-card",
            resolved ? "bg-primary" : "bg-border",
          )}
        />
        {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>

      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-4")}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "font-mono text-[11px] font-medium uppercase tracking-wide",
              resolved ? "text-primary" : "text-foreground",
            )}
          >
            {activity.type}
          </span>
          <span className="text-xs font-medium text-foreground">
            {activity.actorName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {activity.actorType}
          </span>
          {activity.commitSha !== null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {activity.commitSha.slice(0, 7)}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatDate(activity.createdAt)}
          </span>
        </div>
        {activity.description !== null && (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {activity.description}
          </p>
        )}
      </div>
    </li>
  );
}
