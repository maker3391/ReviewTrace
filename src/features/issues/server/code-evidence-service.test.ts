import { afterEach, describe, expect, it, vi } from "vitest";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/db";
import {
 decideVerification,
 verifyCodeEvidence,
} from "@/features/issues/server/code-evidence-service";

/**
 * 이 함수가 실제로 쓰는 chain 만 흉내 낸다.
 *
 * 🔴 **`where` 를 렌더해서 둘을 가른다.** 한 행씩 결과를 적는 UPDATE 와, 끝내 보지 못한
 * 것을 한꺼번에 닫는 UPDATE 는 조건이 다르다 — 뒤엣것에만 `verification` 이 붙는다.
 * Fake 는 조건을 «해석»하지 못하므로 조건을 **읽어서** 구분한다.
 */
function fakeExecutor(rows: Record<string, unknown>[]) {
 const updates: { values: Record<string, unknown>; where: string }[] = [];
 const chain = {
 from: () => chain,
 innerJoin: () => chain,
 where: () => chain,
 orderBy: () => chain,
 // 🔴 상한을 실제로 적용한다 — 넘긴 것을 조용히 다 돌려주면 상한 시험이 무의미하다.
 limit: (count: number) => Promise.resolve(rows.slice(0, count)),
 };

 const executor = {
 select: () => chain,
 update: () => ({
 set: (values: Record<string, unknown>) => ({
 where: (condition: SQL) => {
 updates.push({
 values,
 where: new PgDialect().sqlToQuery(condition).sql,
 });
 return Promise.resolve(undefined);
 },
 }),
 }),
 } as unknown as DbExecutor;

 return {
 executor,
 /** 실제로 확인해 결과를 적은 행들. */
 verdicts: () =>
 updates.filter((update) => !update.where.includes('"verification"')),
 /** 끝내 보지 못한 것을 닫는 문장. */
 closeOuts: () =>
 updates.filter((update) => update.where.includes('"verification"')),
 };
}

/**
 * 🔴 이 시험이 지키는 것은 **「확인하지 못한 것을 확인했다고 적지 않는다」** 와,
 * 그 반대인 **「맞는데 틀렸다고 적지 않는다」** 둘 다이다.
 *
 * 되돌림 확인(2026-08-28): `read.whole` 일 때의 `includes` 를 `===` 로 되돌리면
 * 「줄 범위가 없으면 파일 안에 들어 있는지로 본다」가 실패한다. 직접 확인했다.
 *
 * 이 결함은 실제로 있었다 — 줄 범위 없이 보낸 근거가 파일 전체와 맞대어져
 * **언제나 `MISMATCH`** 로 찍혔다. 화면은 그것을 「Agent 가 거짓말했다」로 그린다.
 */
describe("decideVerification", () => {
 const file = "line1\nline2\nline3\n";

 it("GitHub 에서 못 읽었으면 UNAVAILABLE 이다 — 모르는 것을 안다고 적지 않는다", () => {
 expect(
 decideVerification({ ok: false, reason: "NOT_FOUND" }, "무엇이든"),
).toEqual({ verification: "UNAVAILABLE" });
 });

 it("줄 범위가 있으면 그 줄과 같은지로 본다", () => {
 expect(
 decideVerification({ ok: true, text: "line2", whole: false }, "line2"),
).toEqual({ verification: "VERIFIED" });

 expect(
 decideVerification({ ok: true, text: "line2", whole: false }, "line9"),
).toEqual({ verification: "MISMATCH" });
 });

 it("🔴 줄 범위가 없으면 파일 안에 들어 있는지로 본다", () => {
 expect(decideVerification({ ok: true, text: file, whole: true }, "line2")).toEqual(
 { verification: "VERIFIED" },
);

 expect(
 decideVerification({ ok: true, text: file, whole: true }, "없는 줄"),
).toEqual({ verification: "MISMATCH" });
 });

 it("🔴 줄 범위 없이 코드도 안 보냈으면 파일 전체를 저장하지 않는다", () => {
 const result = decideVerification({ ok: true, text: file, whole: true }, null);

 expect(result.verification).toBe("VERIFIED");
 // 저장 대상은 Review Knowledge 이지 Source Code 사본이 아니다.
 expect(result.snapshot).toBeUndefined();
 });

 it("줄 범위가 있는데 코드를 안 보냈으면 GitHub 것으로 채운다", () => {
 expect(
 decideVerification({ ok: true, text: "line2", whole: false }, null),
).toEqual({ verification: "VERIFIED", snapshot: "line2" });
 });

 it("줄 끝 공백과 줄바꿈 차이로 다르다고 하지 않는다 — 들여쓰기는 건드리지 않는다", () => {
 expect(
 decideVerification(
 { ok: true, text: " const a = 1; \r\n", whole: false },
 " const a = 1;\n",
),
).toEqual({ verification: "VERIFIED" });

 // 🔴 들여쓰기는 코드에서 의미다. 다듬어 같다고 하지 않는다.
 expect(
 decideVerification(
 { ok: true, text: " const a = 1;", whole: false },
 "const a = 1;",
),
).toEqual({ verification: "MISMATCH" });
 });
});

/**
 * 🔴 **정책 함수만 지키는 시험은 «호출 자리» 를 못 지킨다.**
 *
 * `isPublicRepository` 단위 시험 11건을 붙인 뒤 `verifyCodeEvidence` 안의
 * `if (!isPublic)` 를 `if (false)` 로 바꿔 봤더니 **전부 초록이었다** — 정책은 살아 있는데
 * 아무도 그것을 부르지 않는 상태를 시험이 잡지 못했다. 그래서 이 묶음을 더한다.
 *
 * DB 도 네트워크도 쓰지 않는다. `verifyCodeEvidence` 가 `executor` 를 받고, GitHub 은
 * `fetch` 를 갈아 끼우면 된다.
 */
describe("verifyCodeEvidence — private 저장소를 실제로 막는가", () => {
 const ORIGINAL_FETCH = globalThis.fetch;

 const EVIDENCE = {
 id: "aaaaaaaa-0000-4000-8000-000000000001",
 commitSha: "a81f3c2",
 filePath: "src/a.ts",
 startLine: 1,
 endLine: 2,
 snapshot: "const a = 1;",
 provider: "GITHUB" as const,
 owner: "victim",
 name: "secret",
 };

 afterEach(() => {
 globalThis.fetch = ORIGINAL_FETCH;
 vi.restoreAllMocks();
 });

 it("🔴 private 이면 파일을 «읽지도 않고» UNAVAILABLE 로 적는다", async () => {
 const calls: string[] = [];
 globalThis.fetch = vi.fn((input: unknown) => {
 const url = String(input);
 calls.push(url);
 // 저장소 조회는 private 으로 답한다.
 return Promise.resolve({
 ok: true,
 status: 200,
 json: () => Promise.resolve({ private: true }),
 text: () => Promise.resolve("절대 읽히면 안 되는 코드"),
 headers: new Headers(),
 } as unknown as Response);
 }) as unknown as typeof fetch;

 const fake = fakeExecutor([EVIDENCE]);
 await verifyCodeEvidence(
 "22222222-2222-4222-8222-222222222222",
 [EVIDENCE.id],
 fake.executor,
);

 const verdicts = fake.verdicts();
 expect(verdicts).toHaveLength(1);
 expect(verdicts[0]?.values.verification).toBe("UNAVAILABLE");
 // 🔴 파일 내용까지 가지 않는다 — `contents/` 를 부르는 순간 이미 읽은 것이다.
 expect(calls.some((url) => url.includes("/contents/"))).toBe(false);
 // 🔴 Agent 가 보낸 snapshot 을 덮어쓰지 않는다.
 expect(verdicts[0]?.values.snapshot).toBeUndefined();
 });

 it("공개 저장소면 파일까지 읽어 판정한다", async () => {
 globalThis.fetch = vi.fn((input: unknown) => {
 const url = String(input);
 if (url.includes("/contents/")) {
 return Promise.resolve({
 ok: true,
 status: 200,
 headers: new Headers(),
 text: () => Promise.resolve("x\nconst a = 1;\ny\n"),
 } as unknown as Response);
 }
 return Promise.resolve({
 ok: true,
 status: 200,
 json: () => Promise.resolve({ private: false }),
 } as unknown as Response);
 }) as unknown as typeof fetch;

 const fake = fakeExecutor([
 {...EVIDENCE, owner: "acme", name: "app", startLine: 2, endLine: 2 },
 ]);
 await verifyCodeEvidence(
 "22222222-2222-4222-8222-222222222222",
 [EVIDENCE.id],
 fake.executor,
);

 expect(fake.verdicts()[0]?.values.verification).toBe("VERIFIED");
 });
});

/**
 * # 🔴 「조용히 영원한 UNVERIFIED」가 없다
 *
 * ## 무엇이 깨져 있었는가
 *
 * 입력 계약은 Issue 하나당 근거 20개, Review 하나당 Issue 500개를 허용하는데 확인 조회는
 * `MAX_VERIFY_PER_REQUEST = 10` 으로 잘랐다. Route 는 방금 만든 id 로 `verifyCodeEvidence`
 * 를 **한 번만** `after()` 에 예약하고 남은 id 를 다시 큐에 넣는 경로가 없다 — 그래서
 * **11번째 이후는 초기값 `UNVERIFIED` 에 영원히 머물렀다.** 문서는 확인하지 못한 것이
 * `UNAVAILABLE` 로 남는다고 적혀 있었으니 문서와 실제가 어긋나 있었고, 화면은 「아직 확인
 * 중」과 「영영 확인되지 않는다」를 구분할 수 없었다.
 *
 * ## 무엇을 붙들어 두는가
 *
 * 이 호출이 끝날 때 **`UNVERIFIED` 를 닫는 문장이 나간다**는 것. `closeOutUnverified`
 * 호출을 지우면 아래 두 시험이 빨개진다.
 *
 * 🔴 상한 자체를 올려 덮는 것은 답이 아니다 — 500개짜리 Review 에서는 어차피 넘친다.
 */
describe("verifyCodeEvidence — 보지 못한 근거를 닫는다", () => {
 const ORIGINAL_FETCH = globalThis.fetch;
 const WORKSPACE = "22222222-2222-4222-8222-222222222222";

 afterEach(() => {
 globalThis.fetch = ORIGINAL_FETCH;
 vi.restoreAllMocks();
 });

 /** 상한(10)을 넘는 근거를 만든다. */
 const many = (count: number) =>
 Array.from({ length: count }, (_, index) => ({
 id: `aaaaaaaa-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
 commitSha: "a81f3c2",
 filePath: "src/a.ts",
 startLine: 1,
 endLine: 2,
 snapshot: "const a = 1;",
 provider: "GITHUB" as const,
 owner: "acme",
 name: "app",
 }));

 it("🔴 상한을 넘어 보지 못한 근거를 UNAVAILABLE 로 닫는다", async () => {
 globalThis.fetch = vi.fn((input: unknown) => {
 const url = String(input);
 if (url.includes("/contents/")) {
 return Promise.resolve({
 ok: true,
 status: 200,
 headers: new Headers(),
 text: () => Promise.resolve("const a = 1;"),
 } as unknown as Response);
 }
 return Promise.resolve({
 ok: true,
 status: 200,
 json: () => Promise.resolve({ private: false }),
 } as unknown as Response);
 }) as unknown as typeof fetch;

 const rows = many(13);
 const fake = fakeExecutor(rows);
 await verifyCodeEvidence(
 WORKSPACE,
 rows.map((row) => row.id),
 fake.executor,
);

 // GitHub 왕복은 상한만큼만 돈다 — 숫자를 키워 덮은 것이 아니다.
 expect(fake.verdicts()).toHaveLength(10);

 const closeOuts = fake.closeOuts();
 expect(closeOuts).toHaveLength(1);
 expect(closeOuts[0]?.values.verification).toBe("UNAVAILABLE");
 // 🔴 이미 결과가 적힌 행은 조건에서 저절로 빠진다 — 무엇을 봤는지 목록을 들고 다니지 않는다.
 expect(closeOuts[0]?.where).toContain('"verification"');
 // 🔴 id 만으로 찾지 않는다.
 expect(closeOuts[0]?.where).toContain('"workspace_id"');
 });

 /**
 * GitHub 이 아닌 Provider 는 확인할 방법이 아예 없다. 예전에는 `continue` 로 건너뛰어
 * 그 행도 조용히 `UNVERIFIED` 로 남았다.
 */
 it("🔴 확인할 방법이 없는 Provider 의 근거도 UNVERIFIED 로 남지 않는다", async () => {
 globalThis.fetch = vi.fn(() => {
 throw new Error("GitHub 을 부르면 안 된다");
 }) as unknown as typeof fetch;

 const fake = fakeExecutor([{...many(1)[0], provider: "GITLAB" }]);
 await verifyCodeEvidence(WORKSPACE, [many(1)[0]!.id], fake.executor);

 expect(fake.verdicts()).toHaveLength(0);
 expect(fake.closeOuts()[0]?.values.verification).toBe("UNAVAILABLE");
 });
});
