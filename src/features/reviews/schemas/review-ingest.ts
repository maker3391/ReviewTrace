import { z } from "zod";

import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  REVIEW_TARGET_TYPES,
  REVIEWER_TYPES,
  SCM_PROVIDERS,
} from "@/types/review";
import {
  codeEvidenceListSchema,
  optionalDecisionRecordSchema,
} from "@/features/issues/schemas/decision-record";
import { TAG_NAME_MAX_LENGTH } from "@/features/reviews/utils/tag-name";
import { narrativeDescription } from "@/lib/markdown/narrative";
import { rule } from "@/lib/validation/validation-rule";

/**
 * `POST /api/v1/reviews` 의 Payload 계약(스펙 29).
 *
 * 🔴 **외부 입력은 신뢰하지 않는다**. Agent 는 우리 것이 아니고,
 * Route Handler 는 이 Schema 를 통과한 값만 Application Service 로 넘긴다.
 *
 * 🔴 **Client 가 Workspace 를 지정하지 못한다**. Payload 어디에도
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

/**
 * Review 가 어느 Project 로 들어가는가(스펙 1).
 *
 * 🔴 **선택 항목이다.** 보내지 않으면 Workspace 의 `default` Project 로 들어간다 —
 * Agent 는 화면이 없어 Project 를 미리 만들어 둘 수 없고, 첫 Review 를 통째로 거절하면
 * 무엇을 먼저 만들어야 하는지 알 방법이 없다(`resolveIngestProject`).
 *
 * 🔴 **Workspace 자리는 여기에도 없다.** Payload 가 고를 수 있는 것은 API Key 가 정한
 * Workspace **안의** Project 뿐이다.
 */
export const reviewProjectSchema = z.object({
  slug: nonEmpty(IDENTIFIER_MAX),
  /** 새로 만들어질 때 쓰는 표시 이름. 이미 있으면 무시한다 — Agent 가 이름을 덮어쓰지 않는다. */
  name: optionalText(IDENTIFIER_MAX),
});

export const reviewRepositorySchema = z
  .object({
    provider: z.enum(SCM_PROVIDERS),
    /**
     * Provider 쪽 식별자(GitHub 의 숫자 id).
     *
     * 🔴 **선택 항목이다.** Agent 가 아는 것은 git remote 뿐이고, 숫자 id 를 알려면
     * Agent 가 GitHub API 를 따로 불러야 한다 — 기록 하나 남기자고 Agent 에게 저장소
     * 접근 권한을 요구하지 않는다(스펙 7).
     *
     * 보내면 **이름이 바뀌어도 같은 저장소로 남는다.** 안 보내면 `owner/name` 이 신원이
     * 되고 Rename 하면 갈라진다 — 나중에 숫자 id 가 오면 서버가 꿰맨다
     * (`repository-upsert.ts`).
     */
    externalRepositoryId: optionalText(IDENTIFIER_MAX).refine(
      /**
       * 🔴 **`fullname:` 은 서버가 쓰는 예약 접두다**(`repository-upsert.ts`).
       *
       * 그것을 밖에서 보낼 수 있으면, `acme/app` 에 `fullname:foo/bar` 를 적어 둔 뒤
       * 나중에 `foo/bar` 를 id 없이 보내면 **서로 다른 저장소가 한 행으로 합쳐진다** —
       * 두 번째 요청이 만들어 낸 신원이 첫 행과 같아지기 때문이다.
       */
      (value) => value === null || !value.toLowerCase().startsWith("fullname:"),
      rule("reservedExternalRepositoryId"),
    ),
    owner: nonEmpty(IDENTIFIER_MAX),
    name: nonEmpty(IDENTIFIER_MAX),
    /**
     * `owner/name`. 🔴 **`owner`·`name` 과 어긋나면 거절한다**(아래 `refine`).
     *
     * 이 셋을 따로 받아 검사하지 않으면, Evidence 확인은 `owner`·`name` 으로 GitHub 을
     * 읽는데 화면과 검색은 `fullName` 을 보여 준다 — **다른 저장소의 코드가 확인된 근거처럼**
     * 붙는다. 같은 것을 가리키는 세 칸이므로 서로 맞아야 한다.
     */
    fullName: nonEmpty(IDENTIFIER_MAX * 2 + 1),
    defaultBranch: nonEmpty(IDENTIFIER_MAX).default("main"),
    /**
     * Repository 를 사람이 열어 보는 주소. 화면이 `<a href>` 로 그린다.
     *
     * 🔴 **`z.url()` 이 아니라 `z.httpUrl()` 이다.** Zod 의 `url()` 은 「URL 로 파싱되는가」만
     * 보고 Scheme 을 보지 않아 `javascript:alert(1)` · `data:text/html,...` 가 그대로 통과한다.
     * 그 값은 Agent 가 보낸 것이고 우리는 그것을 저장했다가 나중에 링크로 그린다 —
     * 즉 이 한 칸이 저장형 XSS 의 재료가 될 수 있는 유일한 자리다.
     *
     * React 19 가 `javascript:` href 를 렌더 단계에서 막아 주긴 하지만, 그것은 **Renderer 의
     * 구현 세부**이지 우리 계약이 아니다. 링크를 복사하거나 다른 곳에서 열면 그 보호가 없다.
     * 저장 전에 거르는 쪽이 정본이다.
     */
    htmlUrl: z
      .httpUrl()
      .max(2048)
      .nullish()
      .transform((value) => value ?? null),
  })
  .refine(
    // GitHub 은 `owner/name` 의 대소문자를 가리지 않으므로 그 기준으로 맞댄다.
    (repository) =>
      repository.fullName.toLowerCase() ===
      `${repository.owner}/${repository.name}`.toLowerCase(),
    {
      ...rule("fullNameMismatch"),
      path: ["fullName"],
    },
  );

export const reviewTargetSchema = z.object({
  type: z.enum(REVIEW_TARGET_TYPES),
  branch: optionalText(IDENTIFIER_MAX),
  commitSha: optionalText(IDENTIFIER_MAX),
  /** 🔴 PR 은 Optional Metadata 다. Domain Root 가 아니다. */
  pullRequestNumber: optionalPositiveInt(),
});

export const reviewerSchema = z.object({
  /** Agent Route 에서는 검증 뒤에도 이 주장을 믿지 않고 `AGENT` 로 덮어쓴다. */
  type: z.enum(REVIEWER_TYPES),
  /** Agent Route 에서는 API Key 이름을 쓴다. Application Service 직접 호출은 이 값을 쓴다. */
  name: nonEmpty(IDENTIFIER_MAX),
  version: optionalText(IDENTIFIER_MAX),
});

export const reviewIssueInputSchema = z
  .object({
    severity: z.enum(ISSUE_SEVERITIES),
    category: z.enum(ISSUE_CATEGORIES),
    /** 반복되는 문제의 정규화된 개념. Category·Tag 와 다르다. */
    patternKey: optionalText(IDENTIFIER_MAX),
    title: nonEmpty(TITLE_MAX),
    /** 무엇이 문제인가. */
    description: optionalText(DESCRIPTION_MAX).describe(
      narrativeDescription("무엇이 문제인가."),
    ),
    /** 왜 그렇게 됐는가. `description` 과 다른 질문에 답한다(스펙 4). */
    rootCause: optionalText(DESCRIPTION_MAX).describe(
      narrativeDescription("왜 그렇게 됐는가."),
    ),
    /** 이 문제가 실제로 터지는 경로. SECURITY 면 공격 경로, 그 밖이면 실패 경로다. */
    failurePath: optionalText(DESCRIPTION_MAX).describe(
      narrativeDescription(
        "문제가 실제로 터지는 경로. 여러 단계라면 ordered list를 우선 사용한다.",
      ),
    ),
    filePath: optionalText(1024),
    startLine: optionalPositiveInt(),
    endLine: optionalPositiveInt(),
    suggestion: optionalText(DESCRIPTION_MAX).describe(
      narrativeDescription(
        "어떻게 고칠지에 대한 제안. 여러 조치는 bullet list로 쓴다.",
      ),
    ),
    /** 이 Issue 를 만든 바깥 시스템과 그쪽 식별자(스펙 23). 없으면 우리가 처음 만든 것이다. */
    source: optionalText(IDENTIFIER_MAX),
    externalId: optionalText(IDENTIFIER_MAX),
    tags: z
      .array(z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH))
      .max(MAX_TAGS_PER_ISSUE)
      .default([]),
    /**
     * 이미 고치면서 발견한 경우의 판단(스펙 4).
     *
     * 🔴 **Issue 가 아니라 `DETECTED` Activity 에 붙는다.** 같은 Issue 를 나중에 다시
     * 고치면 그때의 판단이 따로 남아야 하기 때문이다 — 덮어쓰지 않는다.
     */
    decision: optionalDecisionRecordSchema,
    /** 이 Issue 가 가리키는 코드(스펙 15). 보통 `BEFORE` 하나다. */
    evidence: codeEvidenceListSchema,
  })
  .refine(
    (issue) =>
      issue.startLine === null ||
      issue.endLine === null ||
      issue.endLine >= issue.startLine,
    { ...rule("endLineBeforeStartLine"), path: ["endLine"] },
  );

export const reviewIngestSchema = z.object({
  project: reviewProjectSchema.nullish().transform((value) => value ?? null),
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
  issues: z
    .array(reviewIssueInputSchema)
    .max(MAX_ISSUES_PER_REVIEW)
    .default([]),
});

export type ReviewIngestInput = z.infer<typeof reviewIngestSchema>;
export type ReviewIssueInput = z.infer<typeof reviewIssueInputSchema>;
