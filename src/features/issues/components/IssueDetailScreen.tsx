import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { PageContainer } from "@/components/molecules/PageContainer";
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
 IssueEvidenceEntry,
} from "@/features/issues/server/issue-detail-query";
import { formatDate } from "@/lib/format/date";
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
 {t.detected} {formatDate(issue.firstDetectedAt)}
 </span>
 {issue.resolvedAt !== null && (
 <>
 <MetaDot />
 <span>
 {t.resolvedAt} {formatDate(issue.resolvedAt)}
 </span>
 </>
)}
 </>
 }
 />

 <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
 {/* ── 본문 ─────────────────────────────────────────────────────── */}
 <div className="flex min-w-0 flex-col gap-5">
 {/*
 🔴 **여기 오는 글은 산문이 아니다.** Agent 가 적은 설명·제안·해결 요약에는
 `rotateRefreshTokenFamilyAtomically(final` 같은 조각이 그대로 들어온다 —
 빈칸이 없어 `whitespace-pre-wrap` 이 끊을 자리를 찾지 못한다. Section 은
 `overflow-hidden` 이라 그 줄이 **스크롤도 없이 잘려 나갔다**(390px 실측 264/237).
 `wrap-anywhere` 는 들어가지 못할 때만 끊으므로 넓은 폭에서는 지금과 같다.
 */}
{issue.description !== null && (
 <Section title={t.description} variant="raised">
 <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-foreground">
 {issue.description}
 </p>
 </Section>
)}

 {issue.rootCause !== null && (
 <Section title={t.rootCause} variant="raised">
 <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-foreground">
 {issue.rootCause}
 </p>
 </Section>
)}

 {issue.failurePath !== null && (
 <Section title={t.failurePath} variant="raised">
 <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-foreground">
 {issue.failurePath}
 </p>
 </Section>
)}

 {/*
 🔴 「Agent 가 해 보라고 한 것」·「실제로 했다의 기록」 같은 부제를 두지 않는다.
 제안과 해결은 나란히 서 있고 제목이 이미 그 차이를 말한다.
 */}
 {issue.suggestion !== null && (
 <Section title={t.suggestion} variant="raised">
 <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-foreground">
 {issue.suggestion}
 </p>
 </Section>
)}

{issue.resolutionSummary !== null && (
 <Section title={t.resolution} variant="raised">
 {/*
 해결 기록만 브랜드 톤을 얹는다 — 이 화면에서 가장 값진 한 칸이기 때문이다.
 🔴 색은 의미에만 쓴다.
 */}
 <p className="whitespace-pre-wrap wrap-anywhere border-l-2 border-primary/40 bg-primary/[0.03] py-1 pl-3 text-sm leading-relaxed text-foreground">
 {issue.resolutionSummary}
 </p>
 </Section>
)}

 {issue.evidence.length > 0 && (
 <Section title={t.codeEvidence} variant="raised">
 <EvidenceList
 evidence={issue.evidence}
 repositoryFullName={issue.repositoryFullName}
 labels={{
 before: t.before,
 after: t.after,
 viewCode: t.viewCode,
 noSnapshot: t.noSnapshot,
 verification: t.evidenceVerification,
 }}
 />
 </Section>
)}

 <Section title={t.history} variant="raised">
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
 evidenceVerification: t.evidenceVerification,
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
 recording: t.recording,
 record: t.record,
 typeOptions: label.activityType,
 }}
 />
 </div>
)}
 </Section>
 </div>

 {/* ── 곁 정보 ───────────────────────────────────────────────────── */}
 <aside className="flex flex-col gap-5">
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
 className="break-all"
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
 <dt className="text-muted-foreground">{t.source}</dt>
 <dd className="mt-1 font-mono break-all">
 {issue.source === null && issue.externalId === null
 ? "—"
 : `${issue.source ?? "?"} / ${issue.externalId ?? "?"}`}
 </dd>
 </div>

 <div>
 <dt className="text-muted-foreground">{t.lastChanged}</dt>
 <dd className="mt-1 tabular-nums">
 {formatDate(issue.updatedAt)}
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
 const decisions = [
 { label: labels.solution, value: activity.solution },
 { label: labels.decisionReason, value: activity.decisionReason },
 { label: labels.alternatives, value: activity.alternativesConsidered },
 { label: labels.tradeOff, value: activity.tradeOff },
 { label: labels.verification, value: activity.verification },
 { label: labels.regressionTest, value: activity.regressionTest },
 { label: labels.residualRisk, value: activity.residualRisk },
 ].filter((entry): entry is { label: string; value: string } => entry.value !== null);

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
 {formatDate(activity.createdAt)}
 </span>
 </div>
{activity.description !== null && (
 <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-xs leading-relaxed text-muted-foreground">
 {activity.description}
 </p>
)}
 {decisions.length > 0 && (
 <div className="mt-3 rounded-md border border-border/70 bg-surface-muted/30 p-3">
 <p className="mb-2 text-[11px] font-semibold text-foreground">
 {labels.decision}
 </p>
 <dl className="grid gap-2 sm:grid-cols-2">
 {decisions.map((entry) => (
 <div key={entry.label} className="min-w-0">
 <dt className="text-[10px] font-medium text-muted-foreground">
 {entry.label}
 </dt>
 <dd className="mt-0.5 whitespace-pre-wrap wrap-anywhere text-xs leading-relaxed text-foreground">
 {entry.value}
 </dd>
 </div>
))}
 </dl>
 </div>
)}
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
 verification: labels.evidenceVerification,
 }}
 />
 </div>
)}
 </div>
 </li>
);
}

interface EvidenceLabels {
 before: string;
 after: string;
 viewCode: string;
 noSnapshot: string;
 verification: Record<EvidenceVerification, string>;
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
 evidenceVerification: Record<EvidenceVerification, string>;
}

const VERIFICATION_CLASS: Record<EvidenceVerification, string> = {
 UNVERIFIED: "bg-muted text-muted-foreground",
 VERIFIED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
 MISMATCH: "bg-destructive/15 text-destructive",
 UNAVAILABLE: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

function EvidenceList({
 evidence,
 repositoryFullName,
 labels,
}: {
 evidence: IssueEvidenceEntry[];
 repositoryFullName: string;
 labels: EvidenceLabels;
}) {
 return (
 <div className="flex flex-col gap-2.5">
 {evidence.map((item) => (
 <article key={item.id} className="min-w-0 overflow-hidden rounded-md border border-border/70">
 <header className="flex flex-wrap items-center gap-2 bg-surface-muted/40 px-3 py-2">
 <span
 className={cn(
 "rounded-full px-2 py-0.5 text-[10px] font-semibold",
 item.kind === "AFTER"
 ? "bg-primary/10 text-primary"
 : "bg-muted text-muted-foreground",
 )}
 >
 {item.kind === "BEFORE" ? labels.before : labels.after}
 </span>
 <span
 className={cn(
 "rounded-full px-2 py-0.5 text-[10px] font-medium",
 VERIFICATION_CLASS[item.verification],
 )}
 >
 {labels.verification[item.verification]}
 </span>
 <span className="min-w-0 break-all font-mono text-[11px] text-foreground">
 {evidenceLocation(item)}
 </span>
 <span className="font-mono text-[10px] text-muted-foreground">
 {item.commitSha.slice(0, 7)}
 </span>
 <a
 href={githubEvidenceUrl(repositoryFullName, item)}
 target="_blank"
 rel="noreferrer noopener"
 className="ml-auto text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
 >
 {labels.viewCode}
 </a>
 </header>
 {item.snapshot === null ? (
 <p className="px-3 py-3 text-xs text-muted-foreground">{labels.noSnapshot}</p>
) : (
 <pre className="max-w-full overflow-x-auto bg-muted/30 p-3 text-xs leading-relaxed text-accent-foreground">
 <code>{item.snapshot}</code>
 </pre>
)}
 </article>
))}
 </div>
 );
}

function evidenceLocation(evidence: IssueEvidenceEntry): string {
 if (evidence.startLine === null) {
 return evidence.filePath;
 }
 if (evidence.endLine === null || evidence.endLine === evidence.startLine) {
 return `${evidence.filePath}:${evidence.startLine}`;
 }
 return `${evidence.filePath}:${evidence.startLine}-${evidence.endLine}`;
}

function githubEvidenceUrl(
 repositoryFullName: string,
 evidence: IssueEvidenceEntry,
): string {
 const repository = repositoryFullName
 .split("/")
 .map((segment) => encodeURIComponent(segment))
 .join("/");
 const filePath = evidence.filePath
 .split("/")
 .map((segment) => encodeURIComponent(segment))
 .join("/");
 const lines =
 evidence.startLine === null
 ? ""
 : evidence.endLine === null || evidence.endLine === evidence.startLine
 ? `#L${evidence.startLine}`
 : `#L${evidence.startLine}-L${evidence.endLine}`;

 return `https://github.com/${repository}/blob/${encodeURIComponent(evidence.commitSha)}/${filePath}${lines}`;
}
