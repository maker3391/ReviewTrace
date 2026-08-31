import { describe, expect, it } from "vitest";
import { type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/db";
import { workspaceInvitations } from "@/db/schema";
import {
 executes,
 failsWith,
 fakeExecutor,
 inserts,
 selects,
 updates,
 type FakeCall,
} from "@/db/testing/fake-executor";
import {
 acceptInvitation,
 createInvitation,
 findInvitationPreview,
 revokeInvitation,
} from "@/features/invitations/server/invitation-service";
import { hashInvitationToken } from "@/features/invitations/server/invitation-token";
import { isAppError } from "@/lib/errors";

/**
 * Workspace 초대의 **판정 규칙** — Database 없이 돈다.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 「Token 원문을 저장하지 않는다」는 이 기능의 **보안 약속**인데, 그것을 확인하는 시험이
 * `workspace.integration.test.ts` 에만 있었다. 그 파일은 `DB_INTEGRATION=true` 없이는
 * 통째로 건너뛰므로, 원문을 그대로 넣는 코드로 바꿔도 기본 `pnpm test` 는 초록이었다.
 *
 * ## 여기서 보지 «않는» 것
 *
 * `WHERE accepted_at IS NULL` 이 붙은 UPDATE 가 **한 번만** 행을 잡는가, 그마저 뚫려도
 * `workspace_members` 의 PK 가 두 번째 INSERT 를 막는가 — 둘 다 Database 가 지키는 것이라
 * 통합시험에 남는다. 여기서는 **행을 돌려받았을 때 어떻게 판단하는가**만 본다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const GUEST = "33333333-3333-4333-8333-333333333333";
const INVITATION = "44444444-4444-4444-8444-444444444444";

const future = () => new Date(Date.now() + 60 * 60 * 1000);
const past = () => new Date(Date.now() - 1000);

async function rejection(promise: Promise<unknown>) {
 try {
 await promise;
 return null;
 } catch (error) {
 return error;
 }
}

describe("createInvitation", () => {
 /**
 * 🔴 **발행도 Workspace 행을 «먼저» 잠근다.** 수락과 같은 행을 잡아 둘을 줄 세우지
 * 않으면 `not exists` 가 옛 snapshot 으로 평가돼, 이미 멤버가 된 사람 앞으로 살아 있는
 * 링크가 하나 더 생긴다(실제 PostgreSQL 로 재현됐다).
 */
 const lockedWorkspace = () => selects([{ slug: "acme" }]);

 /**
 * # 🔴 발행 문장은 «직접 적은 SQL» 이다 — 렌더해서 본다
 *
 * 「이미 멤버인가」 판정이 **INSERT 문장 안**으로 들어갔다(`not exists`). Drizzle 의
 * `values(...)` 에는 조건을 붙일 자리가 없어 그 문장만 SQL 을 직접 적는다.
 *
 * 🔴 그래서 `fake.calls[i].values` 로는 아무것도 볼 수 없다. 무엇을 저장하고 무엇을
 * 조건으로 거는지는 **렌더된 문장과 파라미터**로 본다 — 그러지 않으면 조건이 통째로
 * 빠져도 시험이 초록이다.
 */
 function statement(call: FakeCall | undefined) {
 if (call?.query === undefined) {
 throw new Error("직접 적은 SQL 문장이 아니다");
 }
 return new PgDialect().sqlToQuery(call.query.getSQL());
 }

 /**
 * 🔴 되돌림 확인(2026-08-29): `invitation-token.ts` 의 `tokenHash` 자리에 `token` 을
 * 그대로 넣으면 이 시험이 실패한다. 직접 바꿔 보고 되돌렸다.
 */
 it("🔴 저장되는 것은 Hash 다 — 원문 Token 이 어느 Column 에도 없다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([{ id: INVITATION }])]);

 const invitation = await createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
);

 const sent = statement(fake.calls[1]);
 expect(sent.params).toContain(hashInvitationToken(invitation.token));
 // 문장에도 파라미터에도 원문이 실려 있지 않다.
 expect(sent.sql).not.toContain(invitation.token);
 expect(sent.params).not.toContain(invitation.token);
 });

 /**
 * # 🔴 「이미 멤버인가」를 «따로 조회해서» 판단하지 않는다
 *
 * ## 무엇이 깨져 있었는가
 *
 * 확인이 `SELECT` 한 문장, 발행이 그 다음 `INSERT` 로 나뉘어 있었다. PostgreSQL 의 기본
 * 격리 수준(READ COMMITTED)에서 SELECT 는 **그 문장이 시작한 시점의 스냅샷**을 보므로,
 * 그 사이에 기존 초대가 수락돼 소속이 생겨도 이쪽은 보지 못한다. 그러면 옛 초대 행이
 * 부분 index 밖으로 빠져 **INSERT 가 성공한다** — 이미 멤버인 사람 앞으로 살아 있는
 * 링크가 하나 더 생긴다. 🔴 초대는 이메일을 대조하지 않는 bearer credential 이라
 * (`acceptInvitation` 은 Token Hash 와 상태만 본다) 그 Token 을 쥔 **다른 계정**이
 * 그대로 들어온다.
 *
 * ## 무엇을 붙들어 두는가
 *
 * 판정이 **쓰는 문장 자체**에 실려 있는 것. 조건이 빠지면 이 시험이 빨개진다.
 */
 it("🔴 「이미 멤버가 아닐 것」이 INSERT 문장 자체에 실린다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([{ id: INVITATION }])]);

 await createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
);

 const sent = statement(fake.calls[1]);
 expect(sent.sql).toContain("not exists");
 expect(sent.sql).toContain('"workspace_members"');
 expect(sent.sql).toContain('"users"."email"');
 });

 /**
 * 🔴 **회전 UPDATE 에도 같은 조건이 붙는다.** 만료된 초대가 남아 있는 사이에 그 사람이
 * 다른 초대로 멤버가 됐다면, 회전은 **이미 멤버인 사람에게 새 Token 을 발행하는 일**이
 * 된다 — INSERT 만 막아 두면 그 뒷문이 열려 있다.
 */
 it("🔴 회전 UPDATE 에도 「이미 멤버가 아닐 것」이 실린다", async () => {
 const captured: { where?: SQL } = {};
 const executor: DbExecutor = {
 select: () => ({
 from: () => ({ where: () => ({ for: () => Promise.resolve([{ slug: "acme" }]) }) }),
 }),
 execute: () => Promise.resolve({ rows: [] }),
 transaction: <T>(run: (tx: DbExecutor) => Promise<T>): Promise<T> =>
 run(executor),
 update: () => ({
 set: () => ({
 where: (condition: SQL) => {
 captured.where = condition;
 return { returning: () => Promise.resolve([{ id: INVITATION }]) };
 },
 }),
 }),
 } as unknown as DbExecutor;

 await createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 executor,
);

 const rendered = new PgDialect().sqlToQuery(captured.where as SQL).sql;
 expect(rendered).toContain("not exists");
 expect(rendered).toContain('"workspace_members"');
 });

 it("🔴 이미 멤버인 이메일에는 초대가 발행되지 않는다", async () => {
 // 두 쓰기 문장이 «둘 다» 0행이다 — 그 뒤의 조회는 «메시지를 고르기 위한» 것뿐이다.
 const fake = fakeExecutor([
 lockedWorkspace(),
 executes([]),
 updates([]),
 selects([{ userId: GUEST }]),
 ]);

 const error = await rejection(
 createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("CONFLICT");
 expect(fake.remaining()).toBe(0);
 });

 /**
 * # 🔴 Email 은 «비교하기 전에» 정규화된다
 *
 * ## 무엇이 깨져 있었는가
 *
 * 「이미 멤버」 확인이 **받은 값을 날것 그대로** 비교했다. `users.email` 은 정규 형태로
 * 저장되므로(`lib/auth/github-profile.ts`), `Guest@Example.com` 이 내려오면 이 조건이
 * 어느 행도 잡지 못하고 **이미 멤버인 사람에게 초대가 다시 발행된다.**
 *
 * Schema(`inviteMemberSchema`)가 정규화하니 괜찮다고 볼 수 없다 — 그것은 **폼 경로
 * 하나**이고, Application Service 는 그 밖에서도 불린다 — 최종 판단은 서버가 한다.
 *
 * ## 왜 파라미터를 직접 보는가
 *
 * 저장된 값만 보면 「비교는 여전히 날것으로 하고 저장만 정규화」한 코드가 그대로
 * 통과한다 — 정작 버그가 있던 자리가 비교 쪽이다. 같은 문장 안에 둘 다 실려 있으므로
 * **날것이 한 번도 실리지 않는 것**까지 본다.
 */
 it("🔴 「이미 멤버」 비교에도 저장에도 «정규화된» 이메일이 실린다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([{ id: INVITATION }])]);

 const invitation = await createInvitation(
 { workspaceId: WORKSPACE, email: " Guest@Example.TEST ", invitedBy: OWNER },
 fake.executor,
);

 const sent = statement(fake.calls[1]);
 // 저장하는 값과 비교하는 값이 같은 문장에 함께 실린다.
 expect(sent.params.filter((param) => param === "guest@example.test")).toHaveLength(2);
 // 날것이 실리면 그것은 어느 행도 잡지 못하는 조건이다.
 expect(sent.params).not.toContain(" Guest@Example.TEST ");
 // 화면이 「누구에게 보냈는가」로 그리는 값도 저장된 것과 같다.
 expect(invitation.email).toBe("guest@example.test");
 });

 it("초대에는 유효 기간이 붙는다 — 링크가 영원히 살지 않는다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([{ id: INVITATION }])]);

 const invitation = await createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
);

 expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());

 const sent = statement(fake.calls[1]);
 expect(
 sent.params.some(
 (param) =>
 param instanceof Date &&
 param.getTime() === invitation.expiresAt.getTime(),
),
).toBe(true);
 // 초대는 MEMBER 로만 들어간다 — 발행자가 역할을 고르지 못한다.
 expect(sent.sql).toContain("'MEMBER'::workspace_role");
 expect(sent.sql).not.toContain("'OWNER'");
 });

 /*
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 살아 있는 초대는 (Workspace, Email) 당 하나뿐이다
 *
 * 여기서 볼 수 있는 것은 **「Database 가 무엇을 돌려줬을 때 어떻게 판단하는가」** 와
 * **「어떤 문장을 보냈는가」** 뿐이다. 중복이 «실제로» 막히는지는
 * `invitation-invariant.integration.test.ts` 가 실제 PostgreSQL 로 본다.
 * ─────────────────────────────────────────────────────────────────────────
 */

 /**
 * 🔴 **중복을 막는 것이 Schema 에 실제로 서 있는가.**
 *
 * 제품 코드는 「INSERT 가 0행을 돌려주면 이미 초대가 있다」로 판단한다. 그 전제는
 * **부분 unique index 가 존재할 때만** 참이다 — index 가 없으면 INSERT 는 언제나 성공하고
 * 이 함수는 아무것도 막지 못한다. 그 index 의 모양을 여기서 붙들어 둔다.
 */
 it("🔴 Schema 에 (workspace_id, email) 부분 unique index 가 서 있다", () => {
 const liveIndex = getTableConfig(workspaceInvitations).indexes.find(
 (candidate) =>
 (candidate.config as unknown as { name: string }).name ===
 "workspace_invitations_live_email_unique",
);
 const indexConfig = liveIndex?.config as unknown as {
 unique: boolean;
 where?: SQL;
 columns: { name: string }[];
 };

 expect(indexConfig).toBeDefined();
 expect(indexConfig.unique).toBe(true);
 expect(indexConfig.columns.map((column) => column.name)).toEqual([
 "workspace_id",
 "email",
 ]);

 const predicate = new PgDialect().sqlToQuery(indexConfig.where as SQL).sql;
 // 🔴 수락된 행을 막으면 나갔던 사람을 다시 초대할 수 없다 — index 밖이어야 한다.
 expect(predicate).toContain('"accepted_at" is null');
 // 🔴 취소된 행도 마찬가지다. 취소가 「영영 초대 못 함」이 되어서는 안 된다.
 expect(predicate).toContain('"revoked_at" is null');
 });

 /**
 * 🔴 **중복을 «오류»로 받지 않는다.**
 *
 * `on conflict do nothing` 이 빠지면 unique 위반이 예외로 올라온다. 그러면 Driver 오류
 * message(쿼리와 값이 실려 있다)를 우리가 삼켜야 하고, 열려 있는
 * Transaction 안에서 불렸을 때 그 Transaction 이 통째로 abort 된다.
 *
 * 🔴 **대상을 «적지 않는» 것까지 본다.** 대상을 적으면 PostgreSQL 이 중재할 index 를 계획
 * 단계에서 찾아야 해, Migration 이 아직 적용되지 않은 Database 에서 `42P10` 으로 문장이
 * 통째로 터진다 — 실제로 그렇게 터지는 것을 보고 이 모양으로 바꿨다.
 */
 it("🔴 INSERT 에 «대상 없는» on conflict do nothing 이 붙는다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([{ id: INVITATION }])]);

 await createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
);

 const sent = statement(fake.calls[1]).sql;
 expect(sent).toContain("on conflict do nothing");
 // 중재할 index 를 지목하지 않는다 — 그 index 가 없는 Database 에서 문장이 터진다.
 expect(sent).not.toContain("on conflict (");
 expect(sent).not.toContain("on conflict on constraint");
 });

 it("Database 가 받아 주면 그것으로 끝이다 — 회전 UPDATE 를 부르지 않는다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([{ id: INVITATION }])]);

 await createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
);

 // 🔴 흔한 경로는 Database 왕복 «한 번»이다 — 미리 조회하지 않는다.
 expect(fake.calls.map((call) => call.kind)).toEqual(["select", "execute"]);
 });

 /**
 * 🔴 **살아 있는 초대가 이미 있으면 새 링크를 내주지 않는다.**
 *
 * INSERT 가 거절되고(0행) 회전 UPDATE 도 한 행을 잡지 못한 경우다 — 아직 만료되지
 * 않았다는 뜻이다. 이때 그냥 통과시키면 **저장되지 않은 Token 을 화면이 「초대 링크」로
 * 그린다.** 받은 사람은 영영 수락하지 못한다.
 */
 it("🔴 살아 있는 초대가 이미 있으면 CONFLICT 다 — 저장되지 않은 Token 을 내주지 않는다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([]), updates([]), selects([])]);

 const error = await rejection(
 createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("CONFLICT");
 // 🔴 Driver 오류나 내부 이름이 사용자 메시지에 실리지 않는다.
 const message = isAppError(error) ? error.message : String(error);
 expect(message).not.toContain("duplicate key");
 expect(message).not.toContain("workspace_invitations");
 });

 /**
 * 🔴 만료된 초대는 **회전**한다. 이것이 없으면 7일 뒤 그 주소를 영영 다시 초대할 수 없다.
 *
 * 🔴 **조건이 UPDATE 자체에 붙어 있어야 한다.** 「만료됐는지 조회해 보고 UPDATE」로
 * 나누면 두 요청이 함께 통과한다. `fakeExecutor` 는 `where` 를 해석하지 않으므로
 * **조건에 실린 파라미터와 렌더된 문장**을 직접 본다.
 */
 it("🔴 회전은 «만료된 그 Workspace 의 그 주소» 하나로 한정된다", async () => {
 const captured: { where?: SQL } = {};
 const executor: DbExecutor = {
 select: () => ({
 from: () => ({ where: () => ({ for: () => Promise.resolve([{ slug: "acme" }]) }) }),
 }),
 execute: () => Promise.resolve({ rows: [] }),
 transaction: <T>(run: (tx: DbExecutor) => Promise<T>): Promise<T> =>
 run(executor),
 update: () => ({
 set: () => ({
 where: (condition: SQL) => {
 captured.where = condition;
 return { returning: () => Promise.resolve([{ id: INVITATION }]) };
 },
 }),
 }),
 } as unknown as DbExecutor;

 const invitation = await createInvitation(
 { workspaceId: WORKSPACE, email: " Guest@Example.TEST ", invitedBy: OWNER },
 executor,
);

 const rendered = new PgDialect().sqlToQuery(captured.where as SQL);
 // 대상은 «그 Workspace 의 그 주소» 하나다 — 정규 형태로 비교한다.
 expect(rendered.params).toContain(WORKSPACE);
 expect(rendered.params).toContain("guest@example.test");
 expect(rendered.params).not.toContain(" Guest@Example.TEST ");
 // 🔴 아직 소진되지 않았고, 🔴 이미 만료된 행에만 덮어쓴다.
 expect(rendered.sql).toContain('"accepted_at" is null');
 expect(rendered.sql).toContain('"expires_at" <= now()');
 /*
 🔴 **취소된 행은 회전 대상이 아니다.** 조건이 빠지면 「만료 + 취소」된 행까지 함께
 잡혀 한 UPDATE 가 두 행에 같은 `token_hash` 를 써 넣는다 — unique 가 터진다.
 그보다 나쁘게, 사람이 죽인 초대가 새 기한을 얻어 되살아난다.
 */
 expect(rendered.sql).toContain('"revoked_at" is null');
 expect(invitation.email).toBe("guest@example.test");
 });

 /** 회전 경로도 Hash 만 남긴다 — INSERT 쪽만 보면 이 자리가 비어도 초록이었다. */
 it("🔴 회전시킬 때도 원문 Token 을 저장하지 않는다", async () => {
 const fake = fakeExecutor([lockedWorkspace(), executes([]), updates([{ id: INVITATION }])]);

 const invitation = await createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
);

 const rotated = fake.calls[2]?.values ?? {};
 expect(rotated.tokenHash).toBe(hashInvitationToken(invitation.token));
 expect(JSON.stringify(rotated)).not.toContain(invitation.token);
 // 회전한 행은 방금 발행된 초대다 — 기한이 되살아나야 만료 상태로 남지 않는다.
 expect(rotated.expiresAt).toEqual(invitation.expiresAt);
 });

 /**
 * 🔴 **아무 Database 오류나 「이미 초대했습니다」로 바꾸지 않는다.** 접속이 끊긴 것을
 * `CONFLICT` 로 둔갑시키면 사용자에게 거짓말이 되고, 진짜 장애가 「중복 초대」로 보여
 * 원인을 찾지 못한다. 밖으로 나갈 때 `toPublicError` 가 `INTERNAL_ERROR` 로 좁힌다.
 */
 it("🔴 Database 장애는 CONFLICT 로 둔갑하지 않는다", async () => {
 const driverError = Object.assign(new Error("connection terminated"), {
 code: "08006",
 });
 const fake = fakeExecutor([lockedWorkspace(), failsWith("execute", driverError)]);

 const error = await rejection(
 createInvitation(
 { workspaceId: WORKSPACE, email: "guest@example.test", invitedBy: OWNER },
 fake.executor,
),
);

 expect(isAppError(error)).toBe(false);
 expect(error).toBe(driverError);
 });
});

describe("acceptInvitation", () => {
 /**
 * Database 를 부르는 순서.
 *
 * ```
 * 1 select 초대 -> 어느 Workspace 인가 (잠글 대상을 알기 위한 것)
 * 2 select 그 Workspace 행을 FOR UPDATE 로 잠근다
 * 3 update 초대를 조건부로 소진한다 (자격 판정은 여기서 한다)
 * 4 insert 소속 한 줄
 * ```
 *
 * 🔴 **2 가 3 보다 «먼저»여야 한다.** 계정 삭제는 「이 Workspace 에 나 말고 아무도
 * 없다」를 소속 행 잠금으로 확인한 뒤 Workspace 를 통째로 지우는데, 그 잠금은
 * **그 뒤에 INSERT 되는 소속을 잡지 못한다** — 여기서 같은 Workspace 행을 먼저 잠가야
 * 두 경로가 줄을 선다. 순서를 뒤집으면 초대 행을 쥔 채 Workspace 를 기다리게 되어
 * 삭제 쪽의 CASCADE 와 **deadlock** 이 된다.
 */
 const claimed = (role: "MEMBER" | "OWNER", expiresAt: Date) =>
 updates([
 { workspaceId: WORKSPACE, email: "guest@example.test", role, expiresAt },
 ]);

 const found = () => selects([{ workspaceId: WORKSPACE }]);
 const lockedWorkspace = () => selects([{ slug: "acme" }]);
 /**
 * 🔴 **계정 행도 잠근다 — 초대 행을 건드리기 «전»에.**
 *
 * 아래 UPDATE 의 `accepted_by` 가 FK 로 `users` 에 어차피 잠금을 건다. 미리 잡지
 * 않으면 순서가 `초대 행 -> users` 가 되어, `users` 를 쥔 채 그 사람의 초대 행을
 * 지우는 계정 삭제와 **deadlock** 이 된다(실제로 `40P01` 이 났다).
 */
 const lockedAccount = () => selects([{ id: GUEST }]);

 it("기존 소속은 건드리지 않고 MEMBER 행 하나만 더한다", async () => {
 const fake = fakeExecutor([
 found(),
 lockedWorkspace(),
 lockedAccount(),
 claimed("MEMBER", future()),
 inserts([]),
 ]);

 const slug = await acceptInvitation(
 { token: "A".repeat(43), userId: GUEST },
 fake.executor,
);

 expect(slug).toBe("acme");
 // 더해진 것은 초대받은 Workspace 의 소속 하나뿐이다.
 expect(fake.calls.map((call) => call.kind)).toEqual([
 "select",
 "select",
 "select",
 "update",
 "insert",
 ]);
 expect(fake.calls[4]?.values?.userId).toBe(GUEST);
 expect(fake.calls[4]?.values?.workspaceId).toBe(WORKSPACE);
 });

 /**
 * # 🔴 잠그는 순서는 `workspaces -> users -> 초대 행` 이다
 *
 * ## Workspace 가 초대 UPDATE 보다 «앞»인 이유
 *
 * 계정 삭제는 「나 혼자다」를 확인한 뒤 Workspace 를 통째로 지운다. 그 확인은 소속 행을
 * 잠그지만 **그 뒤에 INSERT 되는 소속은 잡지 못한다** — 여기서 같은 Workspace 행을 먼저
 * 잠가야 두 경로가 줄을 선다.
 *
 * ## 🔴 `users` 가 초대 UPDATE 보다 «앞»인 이유 — 실제로 난 deadlock
 *
 * `accepted_by = $user` 를 쓰면 FK 검사가 `users` 행에 잠금을 건다. 즉 명시적으로 잡지
 * 않으면 순서가 **`초대 행 -> users`** 가 되는데, 계정 삭제는 `users` 를 쥔 채 그 사람의
 * 이메일이 적힌 초대 행을 지운다 — 고리가 닫혀 실제 PostgreSQL 이
 * `40P01 deadlock detected` 를 냈다. 그래서 **초대 행을 건드리기 전에** 명시적으로 잠근다.
 *
 * 실제로 잠기는가·정말 줄을 서는가는 `invitation-invariant.integration.test.ts` 와
 * `account-deletion.integration.test.ts` 가 실제 연결 둘로 본다.
 */
 it("🔴 workspaces -> users -> 초대 행 순으로 잠근다", async () => {
 const order: string[] = [];
 const executor = {
 select: () => ({
 from: () => ({
 where: (condition: SQL) => {
 const rendered = new PgDialect().sqlToQuery(condition).sql;
 const chain = {
 limit: () => {
 order.push("find-invitation");
 return Promise.resolve([{ workspaceId: WORKSPACE }]);
 },
 for: (strength: string) => {
 // 무엇을 잠갔는지는 조건절이 말해 준다.
 if (rendered.includes('"users"."id"')) {
 order.push(`lock-user:${strength}`);
 return Promise.resolve([{ id: GUEST }]);
 }
 order.push(`lock-workspace:${strength}`);
 expect(rendered).toContain('"workspaces"."id"');
 return Promise.resolve([{ slug: "acme" }]);
 },
 };
 return chain;
 },
 }),
 }),
 update: () => ({
 set: () => ({
 where: () => {
 order.push("claim-invitation");
 return {
 returning: () =>
 Promise.resolve([
 {
 workspaceId: WORKSPACE,
 email: "guest@example.test",
 role: "MEMBER",
 expiresAt: future(),
 },
 ]),
 };
 },
 }),
 }),
 insert: () => ({
 values: () => ({ onConflictDoNothing: () => Promise.resolve([]) }),
 }),
 transaction: <T>(run: (tx: DbExecutor) => Promise<T>): Promise<T> =>
 run(executor as unknown as DbExecutor),
 } as unknown as DbExecutor;

 await acceptInvitation({ token: "A".repeat(43), userId: GUEST }, executor);

 expect(order).toEqual([
 "find-invitation",
 "lock-workspace:update",
 // 🔴 FK 가 요구하는 것과 같은 세기다 — 수락끼리는 서로를 막지 않는다.
 "lock-user:key share",
 "claim-invitation",
 ]);
 });

 /**
 * 🔴 **역할은 초대 행에 적힌 것을 쓴다.** 수락하는 쪽이 고르지 못한다 —
 * 그 자리를 열면 링크를 주운 사람이 스스로 OWNER 가 된다.
 */
 it("🔴 역할은 초대에 적힌 값에서 온다 — 수락하는 쪽이 고르지 못한다", async () => {
 const fake = fakeExecutor([
 found(),
 lockedWorkspace(),
 lockedAccount(),
 claimed("OWNER", future()),
 inserts([]),
 ]);

 await acceptInvitation({ token: "A".repeat(43), userId: GUEST }, fake.executor);

 expect(fake.calls[4]?.values?.role).toBe("OWNER");
 });

 /**
 * 🔴 **거절 사유를 구분해 알려 주지 않는다.** 구분해 주면 링크 하나로
 * 「이 초대는 존재한다」·「이미 수락됐다」가 새어 나간다. API Key 의 거절 사유를 구분해
   * 알려 주지 않는 것과 같은 판단이다.
 */
 it("🔴 없는 초대·이미 수락된 초대·만료된 초대가 «구분되지 않는다»", async () => {
 const cases = [
 // 그런 Token 의 초대 자체가 없다.
 fakeExecutor([selects([])]),
 // 🔴 Workspace 가 이미 사라졌다 — 계정 삭제가 먼저 끝난 경우다.
 fakeExecutor([found(), selects([])]),
 // 있지만 이미 수락됐거나 취소돼 UPDATE 가 아무 행도 잡지 못했다.
 fakeExecutor([found(), lockedWorkspace(), lockedAccount(), updates([])]),
 // 잡았지만 만료됐다.
 fakeExecutor([found(), lockedWorkspace(), lockedAccount(), claimed("MEMBER", past())]),
 ];

 const shown: string[] = [];
 for (const fake of cases) {
 const error = await rejection(
 acceptInvitation({ token: "A".repeat(43), userId: GUEST }, fake.executor),
);
 expect(isAppError(error) && error.code).toBe("NOT_FOUND");
 shown.push(isAppError(error) ? `${error.code}|${error.message}` : String(error));
 }

 expect(new Set(shown).size).toBe(1);
 });

 /**
 * 🔴 만료된 초대는 방금 소진돼 버렸다. 그래서 던져서 Transaction 을 통째로 되돌린다 —
 * 소속을 더하지 않는다.
 */
 it("🔴 만료된 초대는 소속을 더하지 않는다", async () => {
 const fake = fakeExecutor([
 found(),
 lockedWorkspace(),
 lockedAccount(),
 claimed("MEMBER", past()),
 ]);

 await rejection(
 acceptInvitation({ token: "A".repeat(43), userId: GUEST }, fake.executor),
);

 expect(fake.calls.map((call) => call.kind)).toEqual([
 "select",
 "select",
 "select",
 "update",
 ]);
 });

 /**
 * 🔴 **취소된 초대는 수락되지 않는다.**
 *
 * 이 조건이 없으면 취소가 목록에서 행을 감추기만 할 뿐, 이미 새어 나간 Token 은 그대로
 * 살아 있다 — 취소 기능이 하는 일이 아무것도 없어진다.
 *
 * 🔴 `fakeExecutor` 는 `where` 를 해석하지 않으므로 **조건이 사라져도 행을 돌려준다.**
 * 그래서 렌더된 문장을 직접 본다. 실제로 그 행이 «안 잡히는가»는 통합시험이 본다.
 */
 it("🔴 초대를 잡는 UPDATE 에 «취소되지 않았을 것» 조건이 붙는다", async () => {
 const captured: { where?: SQL } = {};
 const executor = {
 select: () => ({
 from: () => ({
 where: () => ({
 limit: () => Promise.resolve([{ workspaceId: WORKSPACE }]),
 for: () => Promise.resolve([{ slug: "acme" }]),
 }),
 }),
 }),
 update: () => ({
 set: () => ({
 where: (condition: SQL) => {
 captured.where = condition;
 return { returning: () => Promise.resolve([]) };
 },
 }),
 }),
 transaction: <T>(run: (tx: DbExecutor) => Promise<T>): Promise<T> =>
 run(executor as unknown as DbExecutor),
 } as unknown as DbExecutor;

 await rejection(
 acceptInvitation({ token: "A".repeat(43), userId: GUEST }, executor),
);

 const rendered = new PgDialect().sqlToQuery(captured.where as SQL).sql;
 expect(rendered).toContain('"accepted_at" is null');
 expect(rendered).toContain('"revoked_at" is null');
 });
});

/**
 * 초대 취소.
 *
 * 🔴 여기서 보는 것은 **「행을 돌려받았을 때 어떻게 판단하는가」와 「어떤 문장을 보냈는가」**
 * 뿐이다. 조건이 실제로 남의 Workspace 를 막는지는 `fakeExecutor` 가 `where` 를 해석하지
 * 않으므로 증명할 수 없다 — `invitation-revoke.integration.test.ts` 가 실제 PostgreSQL 로 본다.
 */
describe("revokeInvitation", () => {
 it("🔴 행을 지우지 않는다 — `revokedAt` 을 찍는다", async () => {
 const fake = fakeExecutor([updates([{ id: INVITATION }])]);

 await revokeInvitation(
 { workspaceId: WORKSPACE, invitationId: INVITATION },
 fake.executor,
);

 // 🔴 `delete` 가 아니라 `update` 다. 지우면 누구를 초대했다가 거뒀는지가 함께 사라진다.
 expect(fake.calls.map((call) => call.kind)).toEqual(["update"]);
 expect(fake.calls[0]?.values?.revokedAt).toBeInstanceOf(Date);
 // 다른 Column 을 함께 건드리지 않는다 — Token 도 기한도 그대로 남는다.
 expect(Object.keys(fake.calls[0]?.values ?? {})).toEqual(["revokedAt"]);
 });

 /**
 * 🔴 **Tenant 조건이 `id` 와 «겹쳐서» 걸린다**. `id` 만으로 UPDATE 하면
 * 다른 Workspace 의 OWNER 가 uuid 하나로 남의 초대를 죽인다.
 *
 * 🔴 **이미 소진·취소된 행을 다시 잡지 않는다.** 조건이 UPDATE 자체에 붙어 있어야
 * 동시에 들어온 수락과 취소 중 한쪽만 성공한다.
 */
 it("🔴 조건에 workspaceId 가 «함께» 걸리고, 살아 있는 행만 잡는다", async () => {
 const captured: { where?: SQL } = {};
 const executor = {
 update: () => ({
 set: () => ({
 where: (condition: SQL) => {
 captured.where = condition;
 return { returning: () => Promise.resolve([{ id: INVITATION }]) };
 },
 }),
 }),
 } as unknown as DbExecutor;

 await revokeInvitation(
 { workspaceId: WORKSPACE, invitationId: INVITATION },
 executor,
);

 const rendered = new PgDialect().sqlToQuery(captured.where as SQL);
 expect(rendered.params).toContain(WORKSPACE);
 expect(rendered.params).toContain(INVITATION);
 expect(rendered.sql).toContain('"accepted_at" is null');
 expect(rendered.sql).toContain('"revoked_at" is null');
 });

 /**
 * 🔴 **못 찾은 이유를 구분해 알려 주지 않는다.** 없는 id · 남의 초대 · 이미 수락됨 ·
 * 이미 취소됨이 전부 같은 `NOT_FOUND` 다 — `FORBIDDEN` 으로 답하면 그것만으로
 * 「그 id 는 실재한다」가 새어 나간다.
 */
 it("🔴 한 행도 잡지 못하면 NOT_FOUND 다 — FORBIDDEN 이 아니다", async () => {
 const fake = fakeExecutor([updates([])]);

 const error = await rejection(
 revokeInvitation(
 { workspaceId: WORKSPACE, invitationId: INVITATION },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("NOT_FOUND");
 // 🔴 내부 이름·Driver 문구가 사용자 메시지에 실리지 않는다.
 const message = isAppError(error) ? error.message : String(error);
 expect(message).not.toContain("workspace_invitations");
 expect(message).not.toContain(INVITATION);
 });
});

describe("findInvitationPreview", () => {
 const row = (over: Record<string, unknown> = {}) => ({
 email: "guest@example.test",
 expiresAt: future(),
 acceptedAt: null,
 revokedAt: null,
 workspaceName: "Acme",
 workspaceSlug: "acme",
...over,
 });

 /**
 * 🔴 링크를 주운 사람이 볼 수 있는 화면이다. 초대한 사람·다른 멤버·Workspace 내부를
 * 보여 주지 않는다.
 */
 it("🔴 「어느 Workspace 로의 초대인가」까지만 알린다", async () => {
 const fake = fakeExecutor([selects([row()])]);

 const preview = await findInvitationPreview("A".repeat(43), fake.executor);

 expect(preview).not.toBeNull();
 expect(Object.keys(preview ?? {}).sort()).toEqual([
 "email",
 "workspaceName",
 "workspaceSlug",
 ]);
 });

 it("이미 수락된 초대는 보이지 않는다", async () => {
 const fake = fakeExecutor([selects([row({ acceptedAt: new Date() })])]);

 expect(await findInvitationPreview("A".repeat(43), fake.executor)).toBeNull();
 });

 it("만료된 초대는 보이지 않는다", async () => {
 const fake = fakeExecutor([selects([row({ expiresAt: past() })])]);

 expect(await findInvitationPreview("A".repeat(43), fake.executor)).toBeNull();
 });

 /**
 * 🔴 「취소됐습니다」라고 말해 주지 않는다. 그것만으로 **이 Token 은 실재했다**가
 * 새어 나간다 — 없는 Token 과 같은 결과여야 한다.
 */
 it("🔴 취소된 초대는 보이지 않는다 — 없는 Token 과 구분되지 않는다", async () => {
 const fake = fakeExecutor([selects([row({ revokedAt: new Date() })])]);

 expect(await findInvitationPreview("A".repeat(43), fake.executor)).toBeNull();
 });

 it("없는 Token 도 보이지 않는다 — 만료·수락과 구분되지 않는다", async () => {
 const fake = fakeExecutor([selects([])]);

 expect(await findInvitationPreview("A".repeat(43), fake.executor)).toBeNull();
 });
});
