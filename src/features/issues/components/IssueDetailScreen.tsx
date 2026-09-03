import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { Timestamp } from "@/components/atoms/Timestamp";
import { PageContainer } from "@/components/molecules/PageContainer";
import { MetaDot, PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import {
  readProjectSlugFromPath,
  readWorkspaceSlugFromPath,
} from "@/config/routes";
import { IssueActivityForm } from "@/features/issues/components/IssueActivityForm";
import { EvidenceList } from "@/features/issues/components/CodeEvidence";
import { DecisionRecord } from "@/features/issues/components/DecisionRecord";
import { IssueEditDialog } from "@/features/issues/components/IssueEditDialog";
import { MarkdownContent } from "@/features/issues/components/MarkdownContent";
import { IssueStatusControl } from "@/features/issues/components/IssueStatusControl";
import type {
  IssueActivityEntry,
  IssueDetail,
} from "@/features/issues/server/issue-detail-query";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";
import type { EvidenceVerification } from "@/types/review";

/**
 * ReviewIssue 상세.
 *
 * 화면의 주인공은 **History** 다. 「무슨 문제인가」보다 **「어떻게 여기까지
 * 왔는가」** 가 Knowledge 이기 때문이다.
 *
 * ## 왜 두 단인가
 *
 * 🔴 **읽는 것과 하는 것을 나눈다.** 한 단으로 늘어놓으면 「제목 + 구분선」이 끝없이 이어져
 * 무엇이 본문이고 무엇이 도구인지 구분되지 않는다.
 *
 * ```
 * ┌ 본문(넓게) ─────────────┐ ┌ 곁 정보(좁게) ┐
 * │ 설명 · 제안 · Resolution │ │ 상태 변경 │
 * │ History │ │ 위치 · 식별 │
 * └─────────────────────────┘ └───────────────┘
 * ```
 *
 * 🔴 **`suggestion` 과 `resolutionSummary` 를 한 칸에 섞지 않는다.**
 * 앞은 Agent 가 「해 보라」고 한 것이고 뒤는 「했다」의 기록이다.
 *
 * 상태 전이와 기록 남기기는 사용자 입력이 있는 폼이라 그 자리에서만 Client Component 로
 * 내려간다. 이 화면 자체는 Server Component 로 남는다.
 */
export async function IssueDetailScreen({
  issue,
  reviewsPath,
  repositoriesPath,
}: {
  issue: IssueDetail;
  /** Review 상세로 가는 주소의 뿌리. */
  reviewsPath: Route;
  repositoriesPath: Route;
}) {
  const messages = await readMessages();
  const t = messages.issueDetail;
  const label = messages.enums;

  /*
 Server Action 에 되돌려 줄 주소의 slug.

 🔴 **이 값들은 권한 근거가 아니다**(`src/config/routes.ts`). Server Action 이
 `requireProject` 로 소속을 다시 확인하고, 확인된 `workspaceId` 로만 Issue 를 찾는다 —
 주소를 남의 Workspace 로 바꿔 보내도 조회 자체가 비어서 돌아온다.
 여기서 하는 일은 「지금 어느 주소의 화면인가」를 그대로 서버에 되돌려 주는 것뿐이다.
 */
  const workspaceSlug = readWorkspaceSlugFromPath(reviewsPath);
  const projectSlug = readProjectSlugFromPath(reviewsPath);
  const canAct = workspaceSlug !== null && projectSlug !== null;

  return (
    <PageContainer width="wide" className="gap-6">
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
            <span>{label.category[issue.category]}</span>
            {issue.patternKey !== null && (
              <>
                <MetaDot />
                <span className="font-mono">{issue.patternKey}</span>
              </>
            )}
            <MetaDot />
            <span>
              {t.detected}{" "}
              <Timestamp value={issue.firstDetectedAt} variant="exact" />
            </span>
            {issue.resolvedAt !== null && (
              <>
                <MetaDot />
                <span>
                  {t.resolvedAt}{" "}
                  <Timestamp value={issue.resolvedAt} variant="exact" />
                </span>
              </>
            )}
          </>
        }
        /*
 🔴 **머리글의 Action 은 하나다.** 상태를 옮기는 일과 History 를 남기는 일은 각각
 제자리(상태 Section · History Section)에 이미 있다 — 같은 일을 하는 버튼을 위에 한 번
 더 두면 어느 쪽이 정본인지 흐려진다. 여기 서는 것은 **다른 곳에 자리가 없는 것** 하나다.

 🔴 **삭제 버튼을 두지 않았다.** `review_issues` 를 지우면 `issue_activities` ·
 `issue_code_evidences` · `issue_tags` 가 `ON DELETE CASCADE` 로 함께 사라진다
 (실제 catalog 확인). 이 제품이 지키려는 것이 바로 그 History 다(스펙 1·2) — 「더 이상
 활성 이슈로 보지 않는다」는 상태 Section 의 `IGNORED` · `FALSE_POSITIVE` 가 맡는다.
 그 둘은 `OPEN_ISSUE_STATUSES` 밖이라 목록·Dashboard 의 「열린 Issue」에서 빠지면서도
 무엇을 왜 접었는지가 History 에 남는다.

 🔴 **그 둘을 여기 `⋯` 메뉴로 한 번 더 꺼내 놓지 않는다.** 상태 Select 는 곁 열의 첫
 Section 에 늘 떠 있고 여섯 상태를 «전부» 담고 있어, 메뉴를 두어도 **깊이가 줄지 않는다**
 (열기 → 고르기 → 실행, 어느 쪽이나 세 번이다). 대신 같은 전이가 두 곳에 서서 어느 쪽이
 정본인지 흐려지고, 그중 하나는 되돌릴 자리(다시 `OPEN` 으로)가 없는 반쪽 문이 된다.
 */
        actions={
          canAct ? (
            <IssueEditDialog
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              issueId={issue.id}
              /* 🔴 Issue 전체가 아니라 이 폼이 고치는 칸만 Client 로 내려간다. */
              issue={{
                title: issue.title,
                description: issue.description,
                rootCause: issue.rootCause,
                failurePath: issue.failurePath,
                suggestion: issue.suggestion,
              }}
              labels={{
                trigger: t.edit,
                title: t.editTitle,
                description: t.editHint,
                issueTitle: t.issueTitle,
                optional: t.optional,
                markdownHint: t.markdownHint,
                issueDescription: t.description,
                rootCause: t.rootCause,
                failurePath: t.failurePath,
                suggestion: t.suggestion,
                cancel: t.cancelEdit,
                submit: t.saveEdit,
              }}
            />
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── 본문 ─────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-5">
          {issue.description !== null && (
            <Section title={t.description} variant="raised" tone="narrative">
              <MarkdownContent
                content={issue.description}
                emptyLabel="—"
                baseHeadingLevel={2}
              />
            </Section>
          )}

          {issue.rootCause !== null && (
            <Section title={t.rootCause} variant="raised" tone="narrative">
              <MarkdownContent
                content={issue.rootCause}
                emptyLabel="—"
                baseHeadingLevel={2}
              />
            </Section>
          )}

          {issue.failurePath !== null && (
            <Section title={t.failurePath} variant="raised" tone="narrative">
              <MarkdownContent
                content={issue.failurePath}
                emptyLabel="—"
                baseHeadingLevel={2}
              />
            </Section>
          )}

          {/*
 🔴 「Agent 가 해 보라고 한 것」·「실제로 했다의 기록」 같은 부제를 두지 않는다.
 제안과 해결은 나란히 서 있고 제목이 이미 그 차이를 말한다.
 */}
          {issue.suggestion !== null && (
            <Section title={t.suggestion} variant="raised" tone="narrative">
              <MarkdownContent
                content={issue.suggestion}
                emptyLabel="—"
                baseHeadingLevel={2}
              />
            </Section>
          )}

          {issue.resolutionSummary !== null && (
            <Section title={t.resolution} variant="raised" tone="narrative">
              {/*
 해결 기록만 브랜드 톤을 얹는다 — 이 화면에서 가장 값진 한 칸이기 때문이다.
 🔴 색은 의미에만 쓴다.
 */}
              <div className="border-l-2 border-primary/40 bg-primary/[0.03] py-1 pl-3">
                <MarkdownContent
                  content={issue.resolutionSummary}
                  emptyLabel="—"
                  baseHeadingLevel={2}
                />
              </div>
            </Section>
          )}

          {issue.evidence.length > 0 && (
            <Section title={t.codeEvidence} variant="raised" tone="narrative">
              <EvidenceList
                evidence={issue.evidence}
                repositoryFullName={issue.repositoryFullName}
                labels={{
                  before: t.before,
                  after: t.after,
                  viewCode: t.viewCode,
                  noSnapshot: t.noSnapshot,
                  deletedLines: t.deletedLines,
                  addedLines: t.addedLines,
                  checkedAt: t.checkedAt,
                  showAllLines: t.showAllEvidenceLines,
                  verification: t.evidenceVerification,
                  verificationHint: t.evidenceVerificationHint,
                  workingTree: t.evidenceWorkingTree,
                  workingTreeHint: t.evidenceWorkingTreeHint,
                  viewBaseCommit: t.evidenceViewBaseCommit,
                }}
              />
            </Section>
          )}

          <Section title={t.history} variant="raised" tone="narrative">
            {issue.activities.length === 0 ? (
              <SectionEmpty title={t.noHistory} />
            ) : (
              <ol className="flex flex-col">
                {issue.activities.map((activity, index) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    last={index === issue.activities.length - 1}
                    typeLabel={label.activityType[activity.type]}
                    actorLabel={label.reviewerType[activity.actorType]}
                    repositoryFullName={issue.repositoryFullName}
                    labels={{
                      decision: t.decision,
                      solution: t.solution,
                      decisionReason: t.decisionReason,
                      alternatives: t.alternatives,
                      tradeOff: t.tradeOff,
                      verification: t.verification,
                      regressionTest: t.regressionTest,
                      residualRisk: t.residualRisk,
                      codeEvidence: t.codeEvidence,
                      before: t.before,
                      after: t.after,
                      viewCode: t.viewCode,
                      noSnapshot: t.noSnapshot,
                      deletedLines: t.deletedLines,
                      addedLines: t.addedLines,
                      checkedAt: t.checkedAt,
                      showAllEvidenceLines: t.showAllEvidenceLines,
                      evidenceVerification: t.evidenceVerification,
                      evidenceVerificationHint: t.evidenceVerificationHint,
                      evidenceWorkingTree: t.evidenceWorkingTree,
                      evidenceWorkingTreeHint: t.evidenceWorkingTreeHint,
                      evidenceViewBaseCommit: t.evidenceViewBaseCommit,
                    }}
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
                  labels={{
                    activity: t.activity,
                    activityType: t.activityType,
                    commit: t.commit,
                    commitSha: t.commitSha,
                    optional: t.optional,
                    description: t.activityDescription,
                    recordActions: t.recordActions,
                    typeOptions: label.activityType,
                  }}
                />
              </div>
            )}
          </Section>
        </div>

        {/* ── 곁 정보 ───────────────────────────────────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-5">
          {canAct && (
            <Section title={t.status} variant="raised">
              <IssueStatusControl
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                issueId={issue.id}
                currentStatus={issue.status}
                currentResolutionSummary={issue.resolutionSummary}
                labels={{
                  status: t.status,
                  changeStatus: t.changeStatus,
                  changing: t.changing,
                  resolutionSummary: t.resolutionSummary,
                  editResolutionSummary: t.editResolutionSummary,
                  cancelResolutionSummary: t.cancelResolutionSummary,
                  saveResolutionSummary: t.saveResolutionSummary,
                  emptyResolutionSummary: t.emptyResolutionSummary,
                  statusOptions: label.status,
                }}
              />
            </Section>
          )}

          <Section title={t.location} variant="raised">
            <CodeLocation
              filePath={issue.filePath}
              lineStart={issue.startLine}
              lineEnd={issue.endLine}
              className="block max-w-full truncate"
            />
          </Section>

          <Section title={t.identity} variant="raised">
            <dl className="flex flex-col gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">{t.tags}</dt>
                <dd className="mt-1">
                  {issue.tags.length === 0 ? (
                    <span className="text-muted-foreground/70">—</span>
                  ) : (
                    /*
 🔴 Tag 를 Badge 로 만들지 않는다 — Badge 는 상태·분류의 자리다
. Tag 는 검색용 Keyword 라 옅은 칩이면 충분하다.
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
                <dt className="text-muted-foreground">{t.firstReview}</dt>
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
                <dt className="text-muted-foreground">{t.branch}</dt>
                <dd className="mt-1 min-w-0 truncate font-mono" title={issue.reviewBranch ?? undefined}>
                  {issue.reviewBranch ?? "—"}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">{t.commit}</dt>
                <dd
                  className="mt-1 min-w-0 break-all font-mono"
                  title={issue.reviewCommitSha ?? undefined}
                >
                  {issue.reviewCommitSha ?? "—"}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">{t.source}</dt>
                <dd className="mt-1 min-w-0 font-mono">
                  {issue.source === null && issue.externalId === null ? (
                    "—"
                  ) : (
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {issue.source !== null && (
                        <span
                          className="block max-w-full truncate"
                          title={issue.source}
                        >
                          {issue.source}
                        </span>
                      )}
                      {issue.externalId !== null && (
                        <span
                          className="block max-w-full truncate text-muted-foreground"
                          title={issue.externalId}
                        >
                          {issue.externalId}
                        </span>
                      )}
                    </span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">{t.lastChanged}</dt>
                <dd className="mt-1 tabular-nums">
                  <Timestamp value={issue.updatedAt} variant="exact" />
                </dd>
              </div>
            </dl>
          </Section>
        </aside>
      </div>
    </PageContainer>
  );
}

/**
 * History 한 줄.
 *
 * 🔴 **모든 값을 Badge 로 만들지 않는다**. 시각적으로 구분하는 것은
 * **Activity Type 하나**뿐이고, 행위자·설명·Commit·시각은 Text 계층으로 읽힌다.
 *
 * 왼쪽 세로선과 점이 「한 줄기로 이어진 History」를 만든다 — Agent 작업 로그가 아니라
 * 「이 Issue 가 어떻게 해결됐는가」로 읽혀야 한다.
 */
function ActivityRow({
  activity,
  last,
  typeLabel,
  actorLabel,
  repositoryFullName,
  labels,
}: {
  activity: IssueActivityEntry;
  last: boolean;
  /** 🔴 값이 아니라 이름표다. 값(`RESOLVED`)은 여전히 `activity.type` 이 갖는다. */
  typeLabel: string;
  actorLabel: string;
  repositoryFullName: string;
  labels: ActivityKnowledgeLabels;
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
              "text-[11px] font-semibold tracking-tight",
              resolved ? "text-primary" : "text-foreground",
            )}
          >
            {typeLabel}
          </span>
          <span className="text-xs font-medium text-foreground">
            {activity.actorName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {actorLabel}
          </span>
          {activity.commitSha !== null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {activity.commitSha.slice(0, 7)}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            <Timestamp value={activity.createdAt} variant="exact" />
          </span>
        </div>
        {activity.description !== null && (
          <MarkdownContent
            content={activity.description}
            emptyLabel="—"
            className="mt-1 gap-2 text-muted-foreground [&_p]:text-xs"
            baseHeadingLevel={2}
          />
        )}
        <DecisionRecord activity={activity} labels={labels} />
        {activity.evidence.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-[11px] font-semibold text-foreground">
              {labels.codeEvidence}
            </p>
            <EvidenceList
              evidence={activity.evidence}
              repositoryFullName={repositoryFullName}
              labels={{
                before: labels.before,
                after: labels.after,
                viewCode: labels.viewCode,
                noSnapshot: labels.noSnapshot,
                deletedLines: labels.deletedLines,
                addedLines: labels.addedLines,
                checkedAt: labels.checkedAt,
                showAllLines: labels.showAllEvidenceLines,
                verification: labels.evidenceVerification,
                verificationHint: labels.evidenceVerificationHint,
                workingTree: labels.evidenceWorkingTree,
                workingTreeHint: labels.evidenceWorkingTreeHint,
                viewBaseCommit: labels.evidenceViewBaseCommit,
              }}
            />
          </div>
        )}
      </div>
    </li>
  );
}

interface ActivityKnowledgeLabels {
  decision: string;
  solution: string;
  decisionReason: string;
  alternatives: string;
  tradeOff: string;
  verification: string;
  regressionTest: string;
  residualRisk: string;
  codeEvidence: string;
  before: string;
  after: string;
  viewCode: string;
  noSnapshot: string;
  deletedLines: string;
  addedLines: string;
  checkedAt: string;
  showAllEvidenceLines: (count: number) => string;
  evidenceVerification: Record<EvidenceVerification, string>;
  evidenceVerificationHint: Record<EvidenceVerification, string>;
  evidenceWorkingTree: string;
  evidenceWorkingTreeHint: string;
  evidenceViewBaseCommit: string;
}
