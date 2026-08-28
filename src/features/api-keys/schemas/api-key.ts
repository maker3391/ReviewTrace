import { z } from "zod";

/**
 * API Key 발급 입력.
 *
 * 🔴 **검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다**(CLAUDE.md 9). 화면(RHF)과
 * Server Action 이 같은 Schema 하나를 본다.
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
    .min(1, "Key 이름을 입력하세요.")
    .max(NAME_MAX, `Key 이름은 ${NAME_MAX}자를 넘을 수 없습니다.`),
  expiry: z.enum(API_KEY_EXPIRY_OPTIONS).default("NEVER"),
});

export type IssueApiKeyFormValues = z.input<typeof issueApiKeySchema>;
export type IssueApiKeyInput = z.output<typeof issueApiKeySchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 만료 시각을 만든다.
 *
 * @param now 기준 시각. 부르는 쪽이 넘긴다 — 함수 안에서 `new Date()` 를 부르면
 *   시험이 시간에 흔들린다.
 */
export function resolveExpiresAt(expiry: ApiKeyExpiry, now: Date): Date | null {
  if (expiry === "NEVER") {
    return null;
  }
  return new Date(now.getTime() + Number(expiry) * DAY_MS);
}

/** 화면에 보이는 만료 설명. 표시 문구를 한 곳에 둔다. */
export const API_KEY_EXPIRY_LABEL: Record<ApiKeyExpiry, string> = {
  "30": "30일",
  "90": "90일",
  "365": "1년",
  NEVER: "만료 없음",
};
