import { z } from "zod";

import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  REVIEW_TARGET_TYPES,
  REVIEWER_TYPES,
  SCM_PROVIDERS,
} from "@/types/review";
import { TAG_NAME_MAX_LENGTH } from "@/features/reviews/utils/tag-name";

/**
 * `POST /api/v1/reviews` 의 Payload 계약(스펙 29).
 *
 * 🔴 **외부 입력은 신뢰하지 않는다**(CLAUDE.md 9). Agent 는 우리 것이 아니고,
 * Route Handler 는 이 Schema 를 통과한 값만 Application Service 로 넘긴다.
 *
 * 🔴 **Client 가 Workspace 를 지정하지 못한다**(CLAUDE.md 13). Payload 어디에도
 * `workspaceId` 자리가 없다 — Tenant 는 API Key 가 정한다(스펙 19).
 */

/**
 * 길이 상한.
 *
 * PostgreSQL `text` 는 상한이 없다. 상한을 두는 이유는 검증이 아니라 **한 요청이 쓸 수 있는
 * 양을 정하기 위해서**다 — 없으면 Agent 하나가 수 MB 짜리 설명을 그대로 밀어 넣는다.
 * 값 자체는 Review Knowledge 로 넉넉한 선에서 고른 것이고, 부딪히면 그때 올린다.
 */
const TITLE_MAX = 500;
const DESCRIPTION_MAX = 20_000;
const SUMMARY_MAX = 20_000;
const IDENTIFIER_MAX = 200;

/**
 * 한 Review 가 담을 수 있는 Issue 수.
 *
 * Batch Insert 는 한 문장에 값을 전부 실어 보낸다 — 상한이 없으면 Parameter 수가
 * Driver 한계(문장당 65535개)를 넘겨 요청이 통째로 죽는다. 그 앞에서 명확한
 * `VALIDATION_ERROR` 로 돌려주는 편이 낫다.
 */
export const MAX_ISSUES_PER_REVIEW = 500;

/** 한 Issue 의 Tag 수. Tag 는 분류이지 목록이 아니다. */
const MAX_TAGS_PER_ISSUE = 20;

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/** 없는 값을 `null` 하나로 모은다 — `undefined` 와 `null` 이 갈라지면 저장 코드가 둘을 다 본다. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === "" ? null : value));

const positiveInt = () => z.int().positive();

const optionalPositiveInt = () =>
  positiveInt()
    .nullish()
    .transform((value) => value ?? null);

export const reviewRepositorySchema = z.object({
  provider: z.enum(SCM_PROVIDERS),
  /**
   * 🔴 Provider 쪽 식별자는 **필수**다.
   *
   * Repository 의 Unique 근거이고(스펙 21·26), `owner/name` 은 GitHub 에서 바뀐다.
   * 이름으로 식별하면 Rename 한 순간 같은 Repository 가 둘로 갈라져 Knowledge 가 끊긴다.
   */
  externalRepositoryId: nonEmpty(IDENTIFIER_MAX),
  owner: nonEmpty(IDENTIFIER_MAX),
  name: nonEmpty(IDENTIFIER_MAX),
  fullName: nonEmpty(IDENTIFIER_MAX * 2 + 1),
  defaultBranch: nonEmpty(IDENTIFIER_MAX).default("main"),
  htmlUrl: z
    .url()
    .max(2048)
    .nullish()
    .transform((value) => value ?? null),
});

export const reviewTargetSchema = z.object({
  type: z.enum(REVIEW_TARGET_TYPES),
  branch: optionalText(IDENTIFIER_MAX),
  commitSha: optionalText(IDENTIFIER_MAX),
  /** 🔴 PR 은 Optional Metadata 다. Domain Root 가 아니다(CLAUDE.md 2). */
  pullRequestNumber: optionalPositiveInt(),
});

export const reviewerSchema = z.object({
  type: z.enum(REVIEWER_TYPES),
  /** `codex` · `claude-code` · 사람 이름. Agent 종류를 코드로 못 박지 않는다. */
  name: nonEmpty(IDENTIFIER_MAX),
  version: optionalText(IDENTIFIER_MAX),
});

export const reviewIssueInputSchema = z
  .object({
    severity: z.enum(ISSUE_SEVERITIES),
    category: z.enum(ISSUE_CATEGORIES),
    /** 반복되는 문제의 정규화된 개념. Category·Tag 와 다르다(CLAUDE.md 3). */
    patternKey: optionalText(IDENTIFIER_MAX),
    title: nonEmpty(TITLE_MAX),
    description: optionalText(DESCRIPTION_MAX),
    filePath: optionalText(1024),
    startLine: optionalPositiveInt(),
    endLine: optionalPositiveInt(),
    suggestion: optionalText(DESCRIPTION_MAX),
    /** 이 Issue 를 만든 바깥 시스템과 그쪽 식별자(스펙 23). 없으면 우리가 처음 만든 것이다. */
    source: optionalText(IDENTIFIER_MAX),
    externalId: optionalText(IDENTIFIER_MAX),
    tags: z
      .array(z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH))
      .max(MAX_TAGS_PER_ISSUE)
      .default([]),
  })
  .refine(
    (issue) =>
      issue.startLine === null ||
      issue.endLine === null ||
      issue.endLine >= issue.startLine,
    { message: "endLine 은 startLine 보다 작을 수 없다", path: ["endLine"] },
  );

export const reviewIngestSchema = z.object({
  repository: reviewRepositorySchema,
  target: reviewTargetSchema,
  reviewer: reviewerSchema,
  summary: optionalText(SUMMARY_MAX),
  /**
   * Review 실행 구간. Agent 가 보내면 그대로 남기고, 없으면 저장 시각으로 채운다 —
   * 「언제 돌았는가」는 Agent 만 아는 값이라 우리가 지어내지 않는다.
   */
  startedAt: z.iso
    .datetime({ offset: true })
    .nullish()
    .transform((value) => (value == null ? null : new Date(value))),
  completedAt: z.iso
    .datetime({ offset: true })
    .nullish()
    .transform((value) => (value == null ? null : new Date(value))),
  /**
   * 문제를 하나도 못 찾은 Review 도 Knowledge 다 — 「이 Commit 은 깨끗했다」는 기록이다.
   * 그래서 빈 배열을 거절하지 않는다.
   */
  issues: z.array(reviewIssueInputSchema).max(MAX_ISSUES_PER_REVIEW).default([]),
});

export type ReviewIngestInput = z.infer<typeof reviewIngestSchema>;
export type ReviewIssueInput = z.infer<typeof reviewIssueInputSchema>;
