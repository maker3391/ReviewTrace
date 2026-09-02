import { z } from "zod";

import { AGENT_REVIEW_LANGUAGES } from "@/types/agent";

/**
 * Agent 연결(Credential) 발급 입력.
 *
 * 🔴 **검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다.** 화면과 Server Action 이
 * 같은 Schema 하나를 본다.
 *
 * 🔴 **오류·선택지 «문구» 는 여기 없다** — 규칙과 값만 있고 말은 사전이 갖는다
 * (`config/messages/*.ts` · `lib/validation/zod-error-map.ts`).
 */

/** 만료까지의 일수. 고를 수 있는 값만 둔다 — 날짜 입력을 받아 파싱하지 않는다. */
export const AGENT_CREDENTIAL_EXPIRY_OPTIONS = [
  "30",
  "90",
  "365",
  "NEVER",
] as const;
export type AgentCredentialExpiry =
  (typeof AGENT_CREDENTIAL_EXPIRY_OPTIONS)[number];

export const issueAgentCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiry: z.enum(AGENT_CREDENTIAL_EXPIRY_OPTIONS).default("NEVER"),
  capability: z.enum(["READ_ONLY", "READ_WRITE"]).default("READ_WRITE"),
  reviewLanguage: z.enum(AGENT_REVIEW_LANGUAGES),
});

export type IssueAgentCredentialInput = z.output<
  typeof issueAgentCredentialSchema
>;
export type IssueAgentCredentialFormValues = z.input<
  typeof issueAgentCredentialSchema
>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 만료 시각을 만든다.
 *
 * @param now 기준 시각. 부르는 쪽이 넘긴다 — 함수 안에서 `new Date()` 를 부르면
 * 시험이 시간에 흔들린다.
 */
export function resolveExpiresAt(
  expiry: AgentCredentialExpiry,
  now: Date,
): Date | null {
  if (expiry === "NEVER") {
    return null;
  }
  return new Date(now.getTime() + Number(expiry) * DAY_MS);
}
