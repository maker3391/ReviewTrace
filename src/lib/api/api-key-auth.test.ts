import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbExecutor } from "@/db";
import { authenticateAgent } from "@/lib/api/api-key-auth";
import { generateApiKey } from "@/lib/api/api-key-token";
import { isAppError } from "@/lib/errors";

/**
 * Agent 요청의 Tenant 판정.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 폐기·만료 검사를 **통째로 지워도 `pnpm test` 가 초록이었다.** 「Key 를 폐기하면 그 즉시
 * 막힌다」는 것이 이 제품의 약속인데, 그 약속을 지키는 코드에 시험이 하나도 없었다.
 *
 * ## 🔴 DB 없이 돈다
 *
 * `authenticateAgent` 가 `executor` 를 인자로 받으므로 Fake 하나면 충분하다 —
 * 여기서 확인하려는 것은 **판정 규칙**이지 SQL 이 아니다. 실제 PostgreSQL 을 쓰는
 * 시험은 기본 실행에서 건너뛰게 되어, 정작 매번 돌아야 할 이 규칙이 안 돌게 된다.
 */

interface FakeKeyRow {
 id: string;
 workspaceId: string;
 name: string;
 expiresAt: Date | null;
 revokedAt: Date | null;
}

/**
 * `select … limit(1)` 과 `update … where(…)` 만 흉내 내는 최소 Fake.
 *
 * 🔴 **조건절을 검사하지 않는다.** 그것은 Drizzle 의 일이고, 여기서 보려는 것은
 * 「어떤 행을 받았을 때 통과시키는가」다.
 */
function fakeExecutor(
 rows: FakeKeyRow[],
 onUpdate?: (values: Record<string, unknown>) => void,
): DbExecutor {
 return {
 select: () => ({
 from: () => ({
 where: () => ({
 limit: () => Promise.resolve(rows),
 }),
 }),
 }),
 update: () => ({
 set: (values: Record<string, unknown>) => ({
 where: () => {
 onUpdate?.(values);
 return Promise.resolve(undefined);
 },
 }),
 }),
 } as unknown as DbExecutor;
}

const KEY = generateApiKey();

const row = (over: Partial<FakeKeyRow> = {}): FakeKeyRow => ({
 id: "11111111-1111-4111-8111-111111111111",
 workspaceId: "22222222-2222-4222-8222-222222222222",
 name: "codex-ci",
 expiresAt: null,
 revokedAt: null,
...over,
});

const requestWith = (authorization?: string) =>
 new Request("https://example.test/api/v1/reviews", {
 headers: authorization === undefined ? {} : { authorization },
 });

/** 던져진 것을 「거절이었는가」로만 좁힌다 — 사유는 일부러 보지 않는다. */
async function rejection(promise: Promise<unknown>) {
 try {
 await promise;
 return null;
 } catch (error) {
 return error;
 }
}

describe("authenticateAgent — 통과", () => {
 it("살아 있는 Key 는 그 Workspace 를 돌려준다", async () => {
 const agent = await authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([row()]),
);

 expect(agent.workspaceId).toBe("22222222-2222-4222-8222-222222222222");
 expect(agent.apiKeyId).toBe("11111111-1111-4111-8111-111111111111");
 expect(agent.apiKeyName).toBe("codex-ci");
 });

 it("만료가 «미래»면 통과한다", async () => {
 const later = new Date(Date.now() + 60 * 60 * 1000);

 await expect(
 authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([row({ expiresAt: later })]),
),
).resolves.toMatchObject({ apiKeyName: "codex-ci" });
 });

 it("lastUsedAt 을 찍는다 — 「마지막으로 쓰인 때」를 보여 주기 위한 값이다", async () => {
 const updates: Record<string, unknown>[] = [];

 await authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([row()], (values) => updates.push(values)),
);

 expect(updates).toHaveLength(1);
 expect(updates[0]?.lastUsedAt).toBeInstanceOf(Date);
 });
});

describe("authenticateAgent — 거절", () => {
 /**
 * 🔴 되돌림 확인(2026-08-29): `api-key-auth.ts` 의 `if (key.revokedAt !== null)` 를 지우면
 * 이 시험이 실패한다. 직접 지워 보고 되돌렸다.
 */
 it("🔴 폐기된 Key 는 거절한다 — 폐기는 «그 즉시» 듣는다", async () => {
 const error = await rejection(
 authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([row({ revokedAt: new Date("2026-01-01T00:00:00Z") })]),
),
);

 expect(error).not.toBeNull();
 expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
 });

 /**
 * 🔴 되돌림 확인(2026-08-29): `expiresAt` 검사를 지우면 이 시험이 실패한다.
 */
 it("🔴 만료된 Key 는 거절한다", async () => {
 const past = new Date(Date.now() - 1000);

 const error = await rejection(
 authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([row({ expiresAt: past })]),
),
);

 expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
 });

 it("없는 Key 는 거절한다", async () => {
 const error = await rejection(
 authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([]),
),
);

 expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
 });

 it("헤더가 없으면 Database 를 보지도 않고 거절한다", async () => {
 let looked = false;
 const executor = fakeExecutor([row()]);
 const spy = new Proxy(executor, {
 get(target, prop) {
 if (prop === "select") looked = true;
 return Reflect.get(target, prop);
 },
 }) as DbExecutor;

 const error = await rejection(authenticateAgent(requestWith(), spy));

 expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
 // 🔴 아무 문자열이나 Hash 해서 조회하면 요청마다 Index 를 한 번씩 태우게 된다.
 expect(looked).toBe(false);
 });

 it("형식이 아닌 값도 Database 를 보지 않고 거절한다", async () => {
 for (const header of ["", "Bearer", "Bearer x", "Token ci_abc", "ci_abc"]) {
 const error = await rejection(
 authenticateAgent(requestWith(header), fakeExecutor([row()])),
);
 expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
 }
 });

 /**
 * 🔴 **거절 사유를 구분해 알려 주지 않는다**.
 *
 * 구분해 주면 그것만으로 「이 키는 존재한다」·「이 키는 폐기됐다」가 새어 나가고,
 * 값을 훑어 유효한 Key 를 좁혀 갈 수 있게 된다.
 */
 it("🔴 네 가지 거절이 «구분되지 않는다» — 사유가 새지 않는다", async () => {
 const cases = [
 fakeExecutor([]), // 없는 키
 fakeExecutor([row({ revokedAt: new Date() })]), // 폐기
 fakeExecutor([row({ expiresAt: new Date(Date.now() - 1000) })]), // 만료
 ];

 const errors = await Promise.all(
 cases.map((executor) =>
 rejection(
 authenticateAgent(requestWith(`Bearer ${KEY.plainToken}`), executor),
),
),
);
 errors.push(await rejection(authenticateAgent(requestWith(), fakeExecutor([]))));

 const shown = errors.map((error) =>
 isAppError(error) ? `${error.code}|${error.message}` : String(error),
);

 expect(new Set(shown).size).toBe(1);
 });
});

describe("authenticateAgent — 비밀값이 밖으로 나가지 않는다", () => {
 let logged: string[];

 beforeEach(() => {
 logged = [];
 vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
 logged.push(args.map(String).join(" "));
 });
 vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
 logged.push(args.map(String).join(" "));
 });
 });

 it("🔴 성공 응답에 원문·Hash 가 없다", async () => {
 const agent = await authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([row()]),
);

 const serialized = JSON.stringify(agent);
 expect(serialized).not.toContain(KEY.plainToken);
 expect(serialized).not.toContain(KEY.keyHash);
 // 🔴 Key 이름은 Activity 의 행위자로 쓰인다 — 그것만 나간다.
 expect(Object.keys(agent).sort()).toEqual([
 "apiKeyId",
 "apiKeyName",
 "workspaceId",
 ]);
 });

 it("🔴 거절 message 에 받은 값을 되돌려 담지 않는다", async () => {
 const error = await rejection(
 authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([]),
),
);

 const message = isAppError(error) ? error.message : String(error);
 expect(message).not.toContain(KEY.plainToken);
 expect(message).not.toContain(KEY.keyHash);
 });

 it("🔴 Log 에도 남기지 않는다", async () => {
 await rejection(
 authenticateAgent(
 requestWith(`Bearer ${KEY.plainToken}`),
 fakeExecutor([row({ revokedAt: new Date() })]),
),
);

 expect(logged.join("\n")).not.toContain(KEY.plainToken);
 expect(logged.join("\n")).not.toContain(KEY.keyHash);
 });
});
