import { pgEnum } from "drizzle-orm/pg-core";

import {
  ISSUE_ACTIVITY_TYPES,
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  REVIEW_TARGET_TYPES,
  REVIEWER_TYPES,
  SCM_PROVIDERS,
  WORKSPACE_ROLES,
  CODE_EVIDENCE_KINDS,
  EVIDENCE_VERIFICATIONS,
} from "@/types/review";

/**
 * Domain 값을 Database Enum 으로 못 박는다.
 *
 * `severity` `category` `status` 는 Filter·Statistics 의 축이다(CLAUDE.md 10).
 * 문자열 자유 입력으로 두면 오타 하나가 통계를 갈라놓는다.
 *
 * 값 목록의 정본은 `src/types/review.ts` 다 — 화면·Zod Schema 와 같은 배열을 본다.
 */

export const workspaceRoleEnum = pgEnum("workspace_role", WORKSPACE_ROLES);

/** SCM Provider. Core Domain 을 GitHub API Model 에 종속시키지 않기 위해 값으로만 둔다(CLAUDE.md 15). */
export const scmProviderEnum = pgEnum("scm_provider", SCM_PROVIDERS);

export const reviewTargetTypeEnum = pgEnum(
  "review_target_type",
  REVIEW_TARGET_TYPES,
);

/** Review 를 수행한 주체. 외부 Coding Agent 이거나 사람이다. */
export const reviewerTypeEnum = pgEnum("reviewer_type", REVIEWER_TYPES);

export const issueSeverityEnum = pgEnum("issue_severity", ISSUE_SEVERITIES);

export const issueCategoryEnum = pgEnum("issue_category", ISSUE_CATEGORIES);

export const issueStatusEnum = pgEnum("issue_status", ISSUE_STATUSES);

/**
 * Issue 의 의미 있는 변경 History.
 *
 * 🔴 Event Sourcing 이 아니다. 현재 상태의 정본은 `review_issues` 이고,
 * 이 표는 「어떻게 거기까지 갔는가」를 남길 뿐이다(CLAUDE.md 2).
 */
export const issueActivityTypeEnum = pgEnum(
  "issue_activity_type",
  ISSUE_ACTIVITY_TYPES,
);

/** Code Evidence 가 가리키는 시점(BEFORE · AFTER). */
export const codeEvidenceKindEnum = pgEnum(
  "code_evidence_kind",
  CODE_EVIDENCE_KINDS,
);

/** Agent 가 보낸 Snapshot 을 GitHub 에서 확인한 결과. */
export const evidenceVerificationEnum = pgEnum(
  "evidence_verification",
  EVIDENCE_VERIFICATIONS,
);
