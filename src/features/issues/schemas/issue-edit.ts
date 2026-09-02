import { z } from "zod";

import { narrativeDescription } from "@/lib/markdown/narrative";

/**
 * 사람이 화면에서 Issue 의 **서술**을 고치는 자리의 입력 계약.
 *
 * ## 🔴 무엇을 고칠 수 있는가 — 그리고 왜 나머지는 아닌가
 *
 * 여기 있는 다섯 칸은 전부 **사람이 읽는 Markdown 서술**이다. Agent 가 급하게 적어 둔
 * 문장을 사람이 다듬는 것이 이 기능의 전부다.
 *
 * ```
 * title · description · rootCause · failurePath · suggestion
 * ```
 *
 * 🔴 **`resolutionSummary` 는 여기 없다.** 그 칸은 홀로 서 있지 않고 `status` ·
 * `resolvedAt` 과 한 몸이다 — `RESOLVED` 가 아니면 반드시 `NULL` 이어야 하고, 값이
 * 바뀔 때마다 `IssueActivity` 가 함께 남아야 한다(`issue-status-service.ts`).
 * 일반 수정이 그 칸만 따로 쓰면 **「REOPENED 인데 해결 요약이 적혀 있는」 행**이 곧바로
 * 만들어진다. 그 칸을 고치는 길은 이미 있다 — 상태 자리의 「요약 수정」이 상태 전이를
 * 거쳐 넷을 함께 움직인다.
 *
 * 🔴 **`severity` · `category` · `patternKey` · `filePath` · `startLine` · `endLine` 도
 * 없다.** 그것들은 서술이 아니라 **집계와 Index 의 축**이다(스펙 3·10) — 사람이 화면에서
 * 조용히 바꾸면 Pattern 통계와 Dashboard 의 숫자가 관측된 사실과 어긋난다.
 *
 * 🔴 **`source` · `externalId` 는 신원이다.** 같은 문제를 다음 Review 가 다시 보고했을 때
 * 행을 하나로 유지하는 열쇠라(`review_issues_repository_external_id_unique`), 바꾸는
 * 순간 History 가 둘로 갈라진다.
 *
 * 🔴 **Activity · Code Evidence · `reviewSessionId` · `firstDetectedAt` 은 provenance 다.**
 * 「누가 언제 무엇을 보고 무엇을 했는가」는 고쳐 쓰는 것이 아니라 쌓이는 것이다(스펙 2).
 *
 * ## 상한을 여기 다시 적는 이유
 *
 * Agent 가 Issue 를 **만들 때** 쓰는 상한은 `features/reviews/schemas/review-ingest.ts`
 * 에 있다(`TITLE_MAX` 500 · `DESCRIPTION_MAX` 20_000). 🔴 **그 파일을 import 하지 않는다** —
 * Feature 의존은 `reviews -> issues` 한 방향이고(그쪽이 이미
 * `issues/schemas/decision-record` 를 쓴다) 되돌리면 두 Feature 가 서로를 알게 된다.
 * `issue-status-update.ts` 가 `RESOLUTION_SUMMARY_MAX` 를 스스로 갖는 것과 같은 자리다.
 */

/** `review-ingest.ts` 의 `TITLE_MAX` 와 같은 값이다. */
const TITLE_MAX = 500;
/** `review-ingest.ts` 의 `DESCRIPTION_MAX` 와 같은 값이다. */
const DESCRIPTION_MAX = 20_000;

/**
 * 없는 값을 `null` 하나로 모은다.
 *
 * 🔴 **빈 칸은 「지운다」로 읽는다.** 폼은 값이 없을 때 빈 문자열을 보내므로, 그것을
 * `undefined` 로 두면 「고치지 않았다」와 구분되지 않아 지울 방법이 사라진다.
 */
const optionalNarrative = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === "" ? null : value));

export const issueEditSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  description: optionalNarrative(DESCRIPTION_MAX).describe(
    narrativeDescription("무엇이 문제인가."),
  ),
  rootCause: optionalNarrative(DESCRIPTION_MAX).describe(
    narrativeDescription("왜 그렇게 됐는가."),
  ),
  failurePath: optionalNarrative(DESCRIPTION_MAX).describe(
    narrativeDescription(
      "문제가 실제로 터지는 경로. 여러 단계라면 ordered list를 우선 사용한다.",
    ),
  ),
  suggestion: optionalNarrative(DESCRIPTION_MAX).describe(
    narrativeDescription(
      "어떻게 고칠지에 대한 제안. 여러 조치는 bullet list로 쓴다.",
    ),
  ),
});

/** 🔴 폼이 들고 있는 값(빈 문자열 허용)과 서버가 받는 값(`null` 확정)을 나눈다. */
export type IssueEditValues = z.input<typeof issueEditSchema>;
export type IssueEditInput = z.output<typeof issueEditSchema>;
