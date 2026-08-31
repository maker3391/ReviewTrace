import { z } from "zod";

/**
 * API Key 발급 입력.
 *
 * 🔴 **검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다**. 화면(RHF)과
 * Server Action 이 같은 Schema 하나를 본다.
 *
 * 🔴 **오류 «문구» 는 여기 없다** — 규칙만 있고 말은 사전이 갖는다
 * (`lib/validation/zod-error-map.ts`). 아래 「표시 문구는 여기 두지 않는다」와 같은 이유다.
 */

const NAME_MAX = 100;

/** 만료까지의 일수. 고를 수 있는 값만 둔다 — 날짜 입력을 받아 파싱하지 않는다. */
export const API_KEY_EXPIRY_OPTIONS = ["30", "90", "365", "NEVER"] as const;
export type ApiKeyExpiry = (typeof API_KEY_EXPIRY_OPTIONS)[number];

export const issueApiKeySchema = z.object({
 /** `codex-ci` 처럼 **어느 Agent 의 키인지** 알아볼 이름. 목록에서 이것으로 고른다. */
 name: z
.string()
.trim()
.min(1)
.max(NAME_MAX),
 expiry: z.enum(API_KEY_EXPIRY_OPTIONS).default("NEVER"),
});

export type IssueApiKeyFormValues = z.input<typeof issueApiKeySchema>;
export type IssueApiKeyInput = z.output<typeof issueApiKeySchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 만료 시각을 만든다.
 *
 * @param now 기준 시각. 부르는 쪽이 넘긴다 — 함수 안에서 `new Date()` 를 부르면
 * 시험이 시간에 흔들린다.
 */
export function resolveExpiresAt(expiry: ApiKeyExpiry, now: Date): Date | null {
 if (expiry === "NEVER") {
 return null;
 }
 return new Date(now.getTime() + Number(expiry) * DAY_MS);
}

/*
 🔴 **표시 문구는 여기 두지 않는다.** 선택지의 «값»은 이 Schema 의 것이지만 그 값을
 사람이 읽는 «이름표»는 언어마다 다르다 — `config/messages/*.ts` 의 `apiKeys.expiry*`
 가 갖고, 화면이 그 둘을 이어 붙인다.
*/
