import { z } from "zod";

import { rule } from "@/lib/validation/validation-rule";
import { CODE_EVIDENCE_KINDS } from "@/types/review";

/**
 * Decision Record 와 Code Evidence 의 Payload 계약(스펙 4·15).
 *
 * 「무엇이 문제였나」만 쌓으면 다음 Review 에서 쓸 것이 없다. 재사용되는 것은
 * **무엇을 골랐고 왜 골랐으며 무엇을 내주었는가** 다.
 *
 * 🔴 **이 계약은 REST 와 MCP 가 함께 쓴다.** MCP 는 Tool 모양만 다를 뿐 같은 Schema 를
 * 통과한다 — 두 통로가 서로 다른 규칙을 갖게 만들지 않는다(스펙 1).
 *
 * ## 어디에 붙는가
 *
 * | | 붙는 곳 | 왜 |
 * |---|---|---|
 * | `rootCause` · `failurePath` | ReviewIssue | 발견된 사실이다. 고침을 반복해도 바뀌지 않는다 |
 * | Decision Record | IssueActivity | **한 번의 판단**이다. 시도마다 다르다 |
 * | Code Evidence | Issue(소유) + Activity(출처) | BEFORE 는 Issue 의 것, AFTER 는 그 시도의 것 |
 */

/** 서술 칸의 상한. 검증이 아니라 **한 요청이 쓸 수 있는 양**을 정하는 값이다. */
const NARRATIVE_MAX = 10_000;
const PATH_MAX = 1024;
const SHA_MAX = 200;

/** 한 Issue 에 붙일 수 있는 Evidence 수. 근거는 짚는 것이지 저장소 복제가 아니다. */
export const MAX_EVIDENCE_PER_ISSUE = 20;

/** Snapshot 한 조각의 상한. 줄 범위를 담는 값이지 파일을 담는 값이 아니다. */
export const SNAPSHOT_MAX = 20_000;

const narrative = () =>
 z
.string()
.trim()
.max(NARRATIVE_MAX)
.nullish()
.transform((value) => (value === undefined || value === "" ? null : value));

/**
 * 한 번의 판단.
 *
 * 🔴 **전부 선택 항목이다.** 「Trade-off 를 못 적으면 기록 자체가 거절된다」로 만들면
 * Agent 는 칸을 채우려고 지어낸다 — 빈 칸이 지어낸 문장보다 낫다.
 */
export const decisionRecordSchema = z.object({
 /** 무엇을 했는가. `suggestion`(해 보라)과 다르다 — 이것은 「했다」다. */
 solution: narrative(),
 /** 왜 그것을 골랐는가. */
 decisionReason: narrative(),
 /** 무엇을 함께 검토했고 왜 버렸는가. */
 alternativesConsidered: narrative(),
 /** 그 선택으로 무엇을 내주었는가. */
 tradeOff: narrative(),
 /** 고쳐졌음을 어떻게 확인했는가. */
 verification: narrative(),
 /** 다시 무너지는 것을 무엇이 막는가. */
 regressionTest: narrative(),
 /** 그래도 남아 있는 위험. */
 residualRisk: narrative(),
});

export type DecisionRecordInput = z.infer<typeof decisionRecordSchema>;

/** 판단이 하나도 안 담긴 Record 는 저장하지 않는다 — 빈 칸 일곱 개를 남길 이유가 없다. */
export function hasDecision(decision: DecisionRecordInput | null): boolean {
 return decision !== null && Object.values(decision).some((v) => v !== null);
}

/** 보내지 않으면 `null`. 일곱 칸이 전부 비면 없는 것과 같게 만든다. */
export const optionalDecisionRecordSchema = decisionRecordSchema
.nullish()
.transform((value) =>
 value === undefined || value === null || !hasDecision(value) ? null : value,
);

/**
 * 코드 근거 한 조각.
 *
 * 🔴 **`commitSha` 는 필수다.** 없으면 이 코드가 언제의 것인지 영원히 알 수 없고,
 * GitHub 에서 확인할 방법도 없다 — 근거가 아니라 그냥 문자열이 된다.
 */
export const codeEvidenceSchema = z
.object({
 kind: z.enum(CODE_EVIDENCE_KINDS),
 commitSha: z.string().trim().min(1).max(SHA_MAX),
 filePath: z.string().trim().min(1).max(PATH_MAX),
 startLine: z.int().positive().nullish().transform((v) => v ?? null),
 endLine: z.int().positive().nullish().transform((v) => v ?? null),
 /**
 * Agent 가 읽은 코드 조각.
 *
 * 🔴 **이것은 주장이지 사실이 아니다.** GitHub 에서 확인한 결과는 서버가 따로 적는다
 * (`issue_code_evidences.verification`). Agent 가 확인 결과를 보내지 못한다.
 */
 /**
 * 🔴 **공백뿐인 값은 `null` 과 같게 만든다.**
 *
 * 그것을 「보낸 코드」로 다루면, 줄 범위가 없는 근거에서 「파일 안에 이것이
 * 들어 있는가」가 **언제나 참**이 된다(모든 글자열은 빈 글자열을 품는다) —
 * 아무 코드도 안 보내고 `VERIFIED` 를 받아 낼 수 있다.
 */
 snapshot: z
.string()
.max(SNAPSHOT_MAX)
.nullish()
.transform((v) =>
 v === undefined || v === null || v.trim() === "" ? null : v,
),
 })
.refine(
 (e) => e.startLine === null || e.endLine === null || e.endLine >= e.startLine,
 {...rule("endLineBeforeStartLine"), path: ["endLine"] },
)
 /**
 * 🔴 `endLine` 만 보내는 것을 거절한다.
 *
 * 시작 줄이 없으면 확인 쪽은 「줄 범위가 없다」로 읽어 **파일 전체에서 조각을 찾는다**.
 * 즉 `endLine: 10` 을 보내고 100번째 줄의 코드를 snapshot 으로 넣으면 그것이
 * `VERIFIED` 로 찍힌다 — 보낸 사람이 가리킨 곳과 전혀 다른 자리가 확인된다.
 */
.refine((e) => e.endLine === null || e.startLine !== null, {
...rule("endLineWithoutStartLine"),
 path: ["startLine"],
 });

export type CodeEvidenceInput = z.infer<typeof codeEvidenceSchema>;

export const codeEvidenceListSchema = z
.array(codeEvidenceSchema)
.max(MAX_EVIDENCE_PER_ISSUE)
.default([]);
