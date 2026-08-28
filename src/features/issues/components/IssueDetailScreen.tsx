import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import type { IssueDetail } from "@/features/issues/server/issue-detail-query";
import { formatDate } from "@/lib/format/date";

/**
 * ReviewIssue 상세.
 *
 * 화면의 주인공은 **History** 다(CLAUDE.md 2). 「무슨 문제인가」보다 **「어떻게 여기까지
 * 왔는가」** 가 Knowledge 이기 때문이다.
 *
 * 🔴 **`suggestion` 과 `resolutionSummary` 를 한 칸에 섞지 않는다.**
 * 앞은 Agent 가 「해 보라」고 한 것이고 뒤는 「했다」의 기록이다.
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
  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={issue.severity} />
          <StatusBadge status={issue.status} />
          <span className="font-mono text-[11px] text-muted-foreground">
            {issue.category}
          </span>
          {issue.patternKey !== null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {issue.patternKey}
            </span>
          )}
        </div>
        <h1 className="text-lg font-semibold leading-snug tracking-tight">
          {issue.title}
        </h1>
        <p className="text-[11px] text-muted-foreground">
          <Link
            href={`${repositoriesPath}/${issue.repositoryId}` as Route}
            className="font-mono underline-offset-2 hover:text-foreground hover:underline"
          >
            {issue.repositoryFullName}
          </Link>
          {" · 발견 "}
          {formatDate(issue.firstDetectedAt)}
          {issue.resolvedAt !== null && ` · 해결 ${formatDate(issue.resolvedAt)}`}
          {" · 처음 본 Review "}
          <Link
            href={`${reviewsPath}/${issue.reviewSessionId}` as Route}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            {issue.reviewerName}
          </Link>
        </p>
      </header>

      <Section title="위치">
        <div className="pt-2">
          <CodeLocation
            filePath={issue.filePath}
            lineStart={issue.startLine}
            lineEnd={issue.endLine}
          />
        </div>
      </Section>

      {issue.description !== null && (
        <Section title="설명">
          <p className="whitespace-pre-wrap pt-2 text-sm leading-relaxed">
            {issue.description}
          </p>
        </Section>
      )}

      {issue.suggestion !== null && (
        <Section title="제안" description="Agent 가 「해 보라」고 한 것">
          <p className="whitespace-pre-wrap pt-2 text-sm leading-relaxed">
            {issue.suggestion}
          </p>
        </Section>
      )}

      {issue.resolutionSummary !== null && (
        <Section title="Resolution" description="실제로 「했다」의 기록">
          <p className="whitespace-pre-wrap pt-2 text-sm leading-relaxed">
            {issue.resolutionSummary}
          </p>
        </Section>
      )}

      <Section
        title="History"
        description="Detection → Fix → Re-review → Resolution"
      >
        {issue.activities.length === 0 ? (
          <SectionEmpty>기록이 없습니다.</SectionEmpty>
        ) : (
          <ol className="divide-y divide-border">
            {issue.activities.map((activity) => (
              <li key={activity.id} className="flex gap-3 py-2">
                <span className="w-32 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                  {activity.type}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <span className="font-medium">{activity.actorName}</span>
                    <span className="ml-1 text-muted-foreground">
                      ({activity.actorType})
                    </span>
                    {activity.commitSha !== null && (
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {activity.commitSha.slice(0, 7)}
                      </span>
                    )}
                  </p>
                  {activity.description !== null && (
                    <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
                      {activity.description}
                    </p>
                  )}
                </div>
                <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {formatDate(activity.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="식별">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-6 gap-y-1.5 pt-3 text-xs">
          <dt className="text-muted-foreground">Tags</dt>
          <dd>
            {issue.tags.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              /*
                🔴 Tag 를 Badge 로 만들지 않는다 — Badge 는 상태·분류의 자리다(CLAUDE.md 16).
                Tag 는 검색용 Keyword 라 Text 계층으로 충분하다.
              */
              <span className="font-mono">{issue.tags.join(" · ")}</span>
            )}
          </dd>

          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-mono">
            {issue.source === null && issue.externalId === null
              ? "—"
              : `${issue.source ?? "?"} / ${issue.externalId ?? "?"}`}
          </dd>

          <dt className="text-muted-foreground">마지막 변경</dt>
          <dd className="tabular-nums">{formatDate(issue.updatedAt)}</dd>
        </dl>
      </Section>
    </div>
  );
}
