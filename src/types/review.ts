/**
 * Review Domain 의 값 집합.
 *
 * Database Enum(`src/db/schema/enums.ts`)과 화면·Schema 가 **같은 배열 하나**를 본다.
 * 두 곳에 따로 적으면 DB 에는 있는데 Filter 에는 없는 값이 생긴다.
 *
 * 이 파일은 순수 상수만 둔다 — Drizzle 도 React 도 끌고 오지 않으므로
 * Client Component 가 import 해도 Server 코드가 번들에 섞이지 않는다.
 */

export const ISSUE_SEVERITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** 넓은 기술 영역. Tag(자유 Keyword)·Pattern(정규화된 개념)과 다르다. */
export const ISSUE_CATEGORIES = [
  "ARCHITECTURE",
  "SECURITY",
  "PERFORMANCE",
  "DATABASE",
  "TRANSACTION",
  "CONCURRENCY",
  "API",
  "VALIDATION",
  "EXCEPTION_HANDLING",
  "TESTING",
  "CLEAN_CODE",
  "RELIABILITY",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "IGNORED",
  /** Agent 가 잘못 짚은 것. 「해결됨」과 섞으면 Pattern 통계가 거짓이 된다. */
  "FALSE_POSITIVE",
  /** 해결됐다가 다시 발견된 것. `resolvedAt` 은 다시 비워진다. */
  "REOPENED",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_ACTIVITY_TYPES = [
  "DETECTED",
  "FIX_ATTEMPTED",
  "REVIEWED_AGAIN",
  "RESOLVED",
  "REOPENED",
  "IGNORED",
  "COMMENT",
] as const;
export type IssueActivityType = (typeof ISSUE_ACTIVITY_TYPES)[number];

/** 🔴 Review 대상은 Pull Request 에 한정하지 않는다. */
export const REVIEW_TARGET_TYPES = [
  "PULL_REQUEST",
  "COMMIT",
  "BRANCH",
  "REPOSITORY",
  "MANUAL",
] as const;
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number];

/** Review·Activity 를 남긴 주체. `SYSTEM` 은 우리 코드가 자동으로 남긴 것이다. */
export const REVIEWER_TYPES = ["AGENT", "HUMAN", "SYSTEM"] as const;
export type ReviewerType = (typeof REVIEWER_TYPES)[number];

export const SCM_PROVIDERS = ["GITHUB"] as const;
export type ScmProvider = (typeof SCM_PROVIDERS)[number];

/**
 * Workspace 안에서의 역할.
 *
 * 둘뿐이다 — 만든 사람(`OWNER`)과 초대받은 사람(`MEMBER`).
 * 세분화가 실제로 필요해지기 전에 등급을 늘리지 않는다.
 */
export const WORKSPACE_ROLES = ["OWNER", "MEMBER"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * 아직 손이 필요한 Issue 상태.
 *
 * `IGNORED`·`FALSE_POSITIVE` 는 「더 보지 않기로 한 것」이라 뺀다 — 열린 것에 섞으면
 * Dashboard 의 「지금 봐야 할 수」가 영원히 줄지 않는다.
 *
 * 🔴 Dashboard·Knowledge Context·Project 집계가 **같은 배열 하나**를 본다. 화면마다 따로
 * 적으면 같은 Workspace 를 두 화면이 다른 숫자로 그린다.
 */
export const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "REOPENED",
];

/**
 * Code Evidence 가 가리키는 시점.
 *
 * 🔴 **BEFORE 는 Issue 의 것이고 AFTER 는 한 번의 고침의 것이다.** 그래서 Evidence 는
 * Issue 와 Activity 를 **둘 다** 가리킨다 — 「무엇이 문제였나」와 「어느 시도가 무엇을
 * 바꿨나」가 다른 질문이기 때문이다.
 */
export const CODE_EVIDENCE_KINDS = ["BEFORE", "AFTER"] as const;
export type CodeEvidenceKind = (typeof CODE_EVIDENCE_KINDS)[number];

/**
 * Agent 가 보낸 Code Snapshot 을 GitHub 에서 확인한 결과.
 *
 * 🔴 **Agent 가 보냈다는 것과 GitHub 에 그렇게 있다는 것은 다른 말이다.** 이 값이 그 둘을
 * 갈라 놓는다 — 확인하지 못한 것을 확인한 것처럼 그리지 않기 위해서다.
 *
 * | 값 | 뜻 |
 * |---|---|
 * | `UNVERIFIED` | 아직 확인하지 않았다 |
 * | `VERIFIED` | GitHub 의 해당 Commit·파일·줄 범위와 같았다 |
 * | `MISMATCH` | GitHub 에 있긴 한데 내용이 달랐다 |
 * | `UNAVAILABLE` | 볼 수 없었다 (Private · 없는 Commit/파일 · GitHub 응답 실패 · 아직 커밋 전이라 맞대 볼 원본이 없음) |
 */
/**
 * Snapshot 이 **맞대 볼 immutable source 좌표를 갖는가**.
 *
 * 🔴 **`commitSha` 는 원래 「이 코드가 그 commit 에 있다」는 주장이었다.** 그런데 개발은 늘
 * 「고친다 → 확인한다 → 커밋한다」 순서로 흐르고 **AFTER 근거는 커밋되기 전에 만들어진다.**
 * 그때 Agent 가 적을 수 있는 SHA 는 HEAD 뿐이라, 그 commit 에 **없는** 코드를 가리키는 주장이
 * 되고 대조는 정직하게 실패해 `MISMATCH` 로 남는다 — 실제로 그렇게 쌓인 근거가 있었다.
 *
 * 🔴 **그것은 「코드가 다르다」가 아니라 「맞대 볼 원본이 아직 없다」다.** 두 문장은 다르다.
 * 그래서 좌표의 성격을 값으로 갈라 둔다.
 *
 * | 값 | `commitSha` 의 뜻 | 대조 |
 * |---|---|---|
 * | `COMMITTED` | 이 snapshot 이 **그 commit 에 있다** | GitHub 과 맞대 본다 |
 * | `WORKING_TREE` | 이 작업이 **그 commit 위에서** 이뤄졌다(아직 커밋 전) | 맞대지 않는다 |
 *
 * 🔴 **`WORKING_TREE` 는 「검증 면제」가 아니다.** 확인을 건너뛰라는 표시가 아니라 **확인할
 * 대상이 존재하지 않는다는 사실**이다. 커밋된 코드에 이 값을 붙이면 확인할 수 있는 것을
 * 확인하지 않게 되므로, 이 값은 **보내는 쪽이 실제로 확인했을 때만** 붙인다.
 *
 * 🔴 **좌표를 버리지 않는다.** `commitSha` 는 `WORKING_TREE` 에서도 필수다 — 「어느 코드
 * 위에서 한 작업인가」를 잃으면 그 근거는 시점 없는 문자열이 된다.
 */
export const EVIDENCE_SOURCE_STATES = ["COMMITTED", "WORKING_TREE"] as const;
export type EvidenceSourceState = (typeof EVIDENCE_SOURCE_STATES)[number];

export const EVIDENCE_VERIFICATIONS = [
  "UNVERIFIED",
  "VERIFIED",
  "MISMATCH",
  "UNAVAILABLE",
] as const;
export type EvidenceVerification = (typeof EVIDENCE_VERIFICATIONS)[number];
