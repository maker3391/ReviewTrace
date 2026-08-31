/**
 * ReviewTrace 고유 검증 규칙의 **이름**.
 *
 * ```text
 * schema ──rule("unstorableText")──▶ Zod issue.params ──▶ error map ──▶ 사전의 문구
 * ```
 *
 * 🔴 **이 파일은 아무것도 import 하지 않는다.** Schema 도, 사전(`config/messages`)도,
 * error map(`zod-error-map.ts`)도 여기를 본다 — 셋 중 어느 쪽이 다른 쪽을 알게 되면
 * 「Schema 가 화면의 말을 안다」가 되거나 import 가 고리를 이룬다.
 *
 * 🔴 **`min`·`max`·`email` 같은 일반 규칙은 여기 없다.** 그것은 Zod 가 issue 로 이미
 * 말해 주므로(`code`·`minimum`·`maximum`·`format`) 이름을 따로 붙일 필요가 없다.
 * 여기 있는 것은 **Zod 가 알 수 없는 우리 업무 규칙**뿐이다.
 */

export const VALIDATION_RULES = [
 /** PostgreSQL `text` 가 받지 못하는 문자(NUL · 짝 없는 Surrogate). */
 "unstorableText",
 /** 🔴 `resolved = true` 만 저장하지 않는다. */
 "resolutionSummaryRequired",
 "invitationToken",
 "endLineBeforeStartLine",
 "endLineWithoutStartLine",
 "reservedExternalRepositoryId",
 "fullNameMismatch",
] as const;

export type ValidationRule = (typeof VALIDATION_RULES)[number];

/**
 * Schema 가 규칙에 이름을 붙이는 자리.
 *
 * ```ts
 *.refine(isStorableText, rule("unstorableText"))
 * ```
 *
 * 🔴 **문구를 넘기지 않는다.** `message` 를 함께 주면 Zod 는 그것을 쓰고 per-parse
 * error map 을 **건너뛴다** — 그 순간 다시 한 언어에 묶인다.
 */
export function rule(name: ValidationRule): { params: { rule: ValidationRule } } {
 return { params: { rule: name } };
}
