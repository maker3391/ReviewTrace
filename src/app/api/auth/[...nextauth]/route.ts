import { handlers } from "@/lib/auth";

/**
 * Auth.js Endpoint.
 *
 * 로그인 시작·OAuth 콜백·로그아웃·세션 조회가 전부 여기로 온다.
 * Route Handler 는 HTTP 처리만 한다 — 판단은 `src/lib/auth/config.ts` 의 Callback 이 한다(CLAUDE.md 6).
 *
 * 🔴 이 경로는 공개다(`src/config/routes.ts`). 막으면 로그인 자체가 시작되지 않는다.
 * Agent 용 Public API 는 `/api/v1/**` 로 따로 둔다(CLAUDE.md 13) — 이 자리와 섞지 않는다.
 */
export const { GET, POST } = handlers;
