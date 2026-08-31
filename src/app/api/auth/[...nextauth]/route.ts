import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";
import {
 PerformanceTrace,
 runWithPerformanceTrace,
 runtimePerformanceHeaders,
} from "@/lib/performance/timing";
import { PERFORMANCE_TRACE_HEADER } from "@/proxy";

/**
 * Auth.js Endpoint.
 *
 * 로그인 시작·OAuth 콜백·로그아웃·세션 조회가 전부 여기로 온다.
 * Route Handler 는 HTTP 처리만 한다 — 판단은 `src/lib/auth/config.ts` 의 Callback 이 한다.
 *
 * 🔴 이 경로는 공개다(`src/config/routes.ts`). 막으면 로그인 자체가 시작되지 않는다.
 * Agent 용 Public API 는 `/api/v1/**` 로 따로 둔다 — 이 자리와 섞지 않는다.
 */
export async function GET(request: NextRequest): Promise<Response> {
 const pathname = new URL(request.url).pathname;
 if (pathname !== "/api/auth/callback/github") {
 return handlers.GET(request);
 }

 const trace = new PerformanceTrace(
 "auth.github.callback",
 request.headers.get(PERFORMANCE_TRACE_HEADER) ?? crypto.randomUUID(),
 );
 const response = await runWithPerformanceTrace(trace, () =>
 trace.time("auth.handler", () => handlers.GET(request)),
 );

 const responseHeaders = new Headers(response.headers);
 responseHeaders.set("server-timing", trace.serverTiming());
 for (const [name, value] of Object.entries(runtimePerformanceHeaders())) {
 responseHeaders.set(name, value);
 }
 trace.log();
 return new Response(response.body, {
 status: response.status,
 statusText: response.statusText,
 headers: responseHeaders,
 });
}

export const POST = handlers.POST;
