import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isPublicRepository } from "@/lib/github/content";

/**
 * Private 저장소 차단(스펙 15).
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * `content.ts` 는 이 함수를 두고 **「이것이 없으면 Tenant 경계가 뚫린다」**고 적어 놓았다.
 * 그렇게 적어 놓고 시험이 **한 건도 없었다** — 호출을 통째로 지워도 `pnpm test` 가 초록이었다.
 *
 * 막는 것은 이 경로다:
 *
 * ```
 * Workspace A 의 API Key
 * -> repository = { owner: "남의회사", name: "private" } (아무나 적을 수 있다)
 * -> 서버가 «전역 Token 으로» 그 private 파일을 읽어 snapshot 에 저장
 * -> GET /issues/{id} 가 A 에게 그 코드를 돌려준다
 * ```
 *
 * ## 🔴 DB 도 네트워크도 쓰지 않는다
 *
 * `fetch` 를 갈아 끼우면 된다. 여기서 확인하려는 것은 **판정 규칙**이지 GitHub 이 아니다 —
 * 진짜 GitHub 에 붙는 시험은 한도(시간당 60회)에 걸려 「가끔 빨간」 시험이 되고,
 * 그 순간부터 아무도 읽지 않는다.
 */

const originalFetch = globalThis.fetch;

/** GitHub 응답 하나를 흉내 낸다. `body` 가 없으면 본문 파싱이 실패한다. */
function stubFetch(
 response: { ok: boolean; status?: number; body?: unknown } | Error,
) {
 const spy = vi.fn(() => {
 if (response instanceof Error) {
 return Promise.reject(response);
 }
 return Promise.resolve({
 ok: response.ok,
 status: response.status ?? (response.ok ? 200 : 404),
 json: () =>
 "body" in response
 ? Promise.resolve(response.body)
 : Promise.reject(new Error("본문 없음")),
 } as unknown as Response);
 });

 globalThis.fetch = spy as unknown as typeof fetch;
 return spy;
}

beforeEach(() => {
 // 기본값이 있는 값들이라 없어도 통과한다 — 여기서는 결정적으로 고정만 한다.
 process.env.GITHUB_API_URL = "https://api.github.test";
 delete process.env.GITHUB_API_TOKEN;
});

afterEach(() => {
 globalThis.fetch = originalFetch;
 vi.restoreAllMocks();
});

describe("isPublicRepository", () => {
 it("공개 저장소는 통과한다", async () => {
 stubFetch({ ok: true, body: { private: false } });

 await expect(isPublicRepository("acme", "app")).resolves.toBe(true);
 });

 /**
 * 🔴 되돌림 확인(2026-08-29): `content.ts` 의 `.private === false` 를 `!== true` 로
 * 바꾸면 이 시험이 실패한다. 직접 바꿔 보고 되돌렸다.
 */
 it("🔴 private 저장소는 막는다", async () => {
 stubFetch({ ok: true, body: { private: true } });

 await expect(isPublicRepository("victim", "secret")).resolves.toBe(false);
 });

 /**
 * 🔴 **「모르면 통과」가 되면 안 된다.** 아래 넷은 전부 「확인하지 못했다」이고,
 * 확인하지 못한 것은 공개라고 단정할 수 없다.
 */
 it("🔴 없는 저장소(404)는 막는다", async () => {
 stubFetch({ ok: false, status: 404 });

 await expect(isPublicRepository("acme", "missing")).resolves.toBe(false);
 });

 it("🔴 한도 초과·권한 없음(403)은 막는다", async () => {
 stubFetch({ ok: false, status: 403 });

 await expect(isPublicRepository("acme", "app")).resolves.toBe(false);
 });

 it("🔴 네트워크 실패·timeout 은 막는다", async () => {
 stubFetch(new Error("네트워크가 끊겼다"));

 await expect(isPublicRepository("acme", "app")).resolves.toBe(false);
 });

 it("🔴 본문을 읽지 못해도 막는다", async () => {
 stubFetch({ ok: true }); // json() 이 실패한다

 await expect(isPublicRepository("acme", "app")).resolves.toBe(false);
 });

 it("🔴 `private` 칸이 아예 없으면 공개라고 단정하지 않는다", async () => {
 stubFetch({ ok: true, body: { name: "app" } });

 await expect(isPublicRepository("acme", "app")).resolves.toBe(false);
 });

 it("🔴 `private` 이 문자열 \"false\" 여도 공개로 보지 않는다 — 값의 «타입»까지 본다", async () => {
 stubFetch({ ok: true, body: { private: "false" } });

 await expect(isPublicRepository("acme", "app")).resolves.toBe(false);
 });

 it("응답이 객체가 아니면 막는다", async () => {
 stubFetch({ ok: true, body: "공개입니다" });

 await expect(isPublicRepository("acme", "app")).resolves.toBe(false);
 });
});

describe("isPublicRepository — 비밀값·주소", () => {
 /**
 * 🔴 **모듈을 새로 읽어야 한다.** `githubEnv()` 는 처음 한 번만 파싱하고 캐시한다
 * (`lib/env.ts`) — 의도된 동작이라 시험이 맞춰야지 제품을 고칠 일이 아니다.
 * 앞선 시험들이 이미 Token 없이 한 번 읽었으므로, 여기서 환경만 바꿔서는 듣지 않는다.
 */
 it("🔴 Token 을 URL 이 아니라 헤더에만 담는다", async () => {
 process.env.GITHUB_API_TOKEN = "ghp_TESTTOKEN_DO_NOT_LOG";
 vi.resetModules();

 const spy = stubFetch({ ok: true, body: { private: false } });
 const fresh = await import("@/lib/github/content");

 await fresh.isPublicRepository("acme", "app");

 const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
 expect(String(url)).not.toContain("ghp_TESTTOKEN_DO_NOT_LOG");
 expect(
 (init.headers as Record<string, string>).Authorization,
).toContain("ghp_TESTTOKEN_DO_NOT_LOG");
 });

 it("owner·name 을 인코딩해 다른 자원을 가리키지 못하게 한다", async () => {
 const spy = stubFetch({ ok: true, body: { private: false } });

 await isPublicRepository("acme/../other", "app");

 const [url] = spy.mock.calls[0] as unknown as [string];
 // `/` 가 그대로 나가면 경로가 한 단계 올라간다.
 expect(String(url)).not.toContain("acme/../other");
 });
});
