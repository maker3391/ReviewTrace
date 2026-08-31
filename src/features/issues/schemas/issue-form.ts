import { z } from "zod";

import { issueActivitySchema } from "@/features/issues/schemas/issue-activity";
import { issueStatusUpdateSchema } from "@/features/issues/schemas/issue-status-update";

/**
 * 사람이 브라우저에서 쓰는 폼의 입력 계약.
 *
 * 🔴 **업무 규칙을 여기에 다시 적지 않는다.** 「RESOLVED 로 바꿀 때는 해결 요약이 필요하다」
 * 같은 판정은 Agent API 가 쓰는 Schema(`issue-status-update.ts`·`issue-activity.ts`)에 이미
 * 있고, 화면은 **그것을 그대로** 쓴다. 사람이 쓰는 화면과 Agent 가 쓰는 API 가 서로 다른
 * Schema 를 보면 두 경로가 허용하는 것이 갈라진다 — 같은 Domain 에 두 개의 진실이 생긴다.
 *
 * 그래서 이 파일에 있는 것은 **화면에만 해당하는 좁힘** 두 가지뿐이다.
 */

/**
 * 상태 전이 폼이 다루는 값.
 *
 * 🔴 **입력 타입과 출력 타입을 나눈다.** `resolutionSummary` 는 넣을 때는 없어도 되고
 * 나올 때는 `null` 로 확정된다 — React Hook Form 은 앞을, Server Action 은 뒤를 다룬다.
 *
 * `actor` 는 이 Schema 에서 선택 값이라 폼이 아예 등록하지 않는다. 🔴 **누가 바꿨는가는
 * 세션이 정한다** — 화면이 보낸 이름을 쓰면 History 가 곧바로 거짓이 된다.
 */
export type IssueStatusFormValues = z.input<typeof issueStatusUpdateSchema>;
export type IssueStatusFormInput = z.output<typeof issueStatusUpdateSchema>;

/**
 * 사람이 History 에 **직접** 남길 수 있는 Activity.
 *
 * 🔴 `DETECTED`·`RESOLVED`·`REOPENED`·`IGNORED` 는 여기 없다. 그것들은 **상태 전이가
 * 남기는 것**이고(`ACTIVITY_TYPE_BY_STATUS`), 손으로도 남길 수 있게 두면 「History 에는
 * RESOLVED 인데 상태는 OPEN」인 행을 사람이 만들 수 있다. 상태와 History 가 서로 모순되지
 * 않아야 한다는 것이 상태 전이 설계의 전제다(`issue-status-service.ts`).
 */
export const MANUAL_ACTIVITY_TYPES = [
 "COMMENT",
 "FIX_ATTEMPTED",
 "REVIEWED_AGAIN",
] as const;

/**
 * 🔴 **필드 정의를 베끼지 않고 Agent API 의 Schema 에서 덜어낸다.**
 * `actor` 만 빼고 `type` 만 좁힌다 — `description`·`commitSha` 의 상한과 정규화는
 * 두 경로가 같은 규칙을 쓴다.
 */
export const issueActivityFormSchema = issueActivitySchema
.omit({ actor: true })
.extend({ type: z.enum(MANUAL_ACTIVITY_TYPES) });

export type IssueActivityFormValues = z.input<typeof issueActivityFormSchema>;
export type IssueActivityFormInput = z.output<typeof issueActivityFormSchema>;
