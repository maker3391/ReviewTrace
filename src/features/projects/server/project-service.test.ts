import { describe, expect, it } from "vitest";

import {
 deletes,
 failsWith,
 fakeExecutor,
 inserts,
 selects,
 updates,
} from "@/db/testing/fake-executor";
import {
 createProject,
 deleteProject,
 resolveIngestProject,
 updateProject,
} from "@/features/projects/server/project-service";
import { isAppError } from "@/lib/errors";

/**
 * Project Application Service 의 **판정 규칙** — Database 없이 돈다.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 이 규칙들은 `project.integration.test.ts` 에만 있었고, 그 파일은 `DB_INTEGRATION=true`
 * 없이는 **통째로 건너뛴다.** 즉 「직접 적은 slug 를 조용히 바꾸지 않는다」·「unique 위반을
 * 500 이 아니라 CONFLICT 로 돌려준다」 같은 약속이 기본 `pnpm test` 에서 한 번도 확인되지
 * 않았다.
 *
 * ## 여기서 보지 «않는» 것
 *
 * `UNIQUE(workspace_id, slug)` 가 실제로 걸려 있는가 · `workspaceId` 조건이 남의 Tenant 를
 * 실제로 걸러 내는가 · Cascade 로 무엇이 함께 지워지는가 — 전부 Database 가 지키는 것이라
 * `project.integration.test.ts` 에 그대로 남아 있다. 여기서는 **행을 돌려받았을 때 어떻게
 * 판단하는가**만 본다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";

const input = (over: Partial<{ name: string; slug: string; description: string }> = {}) => ({
 name: "SMIL",
 slug: "",
 description: "",
...over,
});

const projectRow = (slug: string) => ({
 projectId: `p-${slug}`,
 slug,
 name: "SMIL",
 description: null,
});

/** 던져진 것을 잡아 돌려준다. `rejects` 만으로는 code·message 를 함께 볼 수 없다. */
async function rejection(promise: Promise<unknown>) {
 try {
 await promise;
 return null;
 } catch (error) {
 return error;
 }
}

describe("createProject — slug 후보", () => {
 it("이름에서 유도한 slug 가 겹치면 다음 후보로 넘어간다", async () => {
 const fake = fakeExecutor([inserts([]), inserts([projectRow("smil-2")])]);

 const created = await createProject(
 { workspaceId: WORKSPACE, createdBy: USER, input: input() },
 fake.executor,
);

 expect(created.slug).toBe("smil-2");
 expect(fake.calls[0]?.values?.slug).toBe("smil");
 expect(fake.calls[1]?.values?.slug).toBe("smil-2");
 });

 /**
 * 🔴 되돌림 확인(2026-08-29): `const attempts = explicitSlug ? 1 : MAX_SLUG_ATTEMPTS` 를
 * `MAX_SLUG_ATTEMPTS` 하나로 바꾸면 이 시험이 실패한다(호출이 5번이 되고 `smil-2` 가
 * 만들어진다). 직접 바꿔 보고 되돌렸다.
 */
 it("🔴 slug 를 «직접» 적었는데 겹치면 조용히 바꾸지 않고 거절한다", async () => {
 const fake = fakeExecutor([inserts([])]);

 const error = await rejection(
 createProject(
 {
 workspaceId: WORKSPACE,
 createdBy: USER,
 input: input({ slug: "smil" }),
 },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("CONFLICT");
 // 한 번만 시도했다 — 사용자가 적은 것과 다른 주소를 만들어 두지 않는다.
 expect(fake.calls).toHaveLength(1);
 expect(fake.remaining()).toBe(0);
 });

 it("유도한 slug 는 다섯 번까지 시도하고 그래도 안 되면 slug 를 정해 달라고 한다", async () => {
 const fake = fakeExecutor([
 inserts([]),
 inserts([]),
 inserts([]),
 inserts([]),
 inserts([]),
 ]);

 const error = await rejection(
 createProject(
 { workspaceId: WORKSPACE, createdBy: USER, input: input() },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("CONFLICT");
 expect(fake.calls).toHaveLength(5);
 expect(fake.calls[4]?.values?.slug).toBe("smil-5");
 });
});

describe("createProject — 저장 직전의 값", () => {
 /**
 * 🔴 `workspaceId` 는 **소속 확인을 통과한 명령의 값**이고, 입력이 고를 수 있는 것은
 * 이름·slug·설명뿐이다.
 */
 it("🔴 workspaceId 는 명령이 준 값으로 들어간다", async () => {
 const fake = fakeExecutor([inserts([projectRow("smil")])]);

 await createProject(
 { workspaceId: WORKSPACE, createdBy: USER, input: input() },
 fake.executor,
);

 expect(fake.calls[0]?.values?.workspaceId).toBe(WORKSPACE);
 expect(fake.calls[0]?.values?.createdBy).toBe(USER);
 });

 it("빈 설명은 null 로 저장한다 — 「없음」과 「빈 문자열」을 구분한다", async () => {
 const fake = fakeExecutor([inserts([projectRow("smil")])]);

 await createProject(
 { workspaceId: WORKSPACE, createdBy: USER, input: input() },
 fake.executor,
);

 expect(fake.calls[0]?.values?.description).toBeNull();
 });

 /**
 * 🔴 `/w/{ws}/p/{projectSlug}/settings` 아래에 Section 이 온다. `settings` 라는 이름의
 * Project 를 만들면 주소가 갈린다.
 */
 it("🔴 화면 주소로 쓰이는 이름은 Database 를 보지도 않고 거절한다", async () => {
 const fake = fakeExecutor([]);

 const error = await rejection(
 createProject(
 {
 workspaceId: WORKSPACE,
 createdBy: USER,
 input: input({ name: "Settings" }),
 },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("VALIDATION_ERROR");
 expect(fake.calls).toHaveLength(0);
 });
});

describe("updateProject", () => {
 it("고칠 대상이 없으면 NOT_FOUND 다", async () => {
 const fake = fakeExecutor([updates([])]);

 const error = await rejection(
 updateProject(
 {
 workspaceId: OTHER_WORKSPACE,
 projectId: "p-smil",
 input: input({ slug: "hijacked" }),
 },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("NOT_FOUND");
 });

 /**
 * 🔴 unique 위반은 **사용자 입력 문제**다 — 500 이 아니라 `CONFLICT` 다. 그리고 Driver 의
 * 오류 message 에는 쿼리와 값이 실려 온다. 그것을 그대로 흘리면 내부 구조가 새어 나간다
 *.
 *
 * 🔴 되돌림 확인(2026-08-29): `.catch(...)` 를 지우면 던져진 것이 AppError 가 아니게 되어
 * 이 시험이 실패한다. 직접 지워 보고 되돌렸다.
 */
 it("🔴 unique 위반을 CONFLICT 로 바꾸고 Driver message 를 밖으로 내보내지 않는다", async () => {
 const driverError = new Error(
 'duplicate key value violates unique constraint "projects_workspace_slug_unique" — Key (workspace_id, slug)=(…, smil) already exists',
);
 // 🔴 실제 `pg` 는 SQLSTATE 를 `code` 에 담아 온다. 그것이 unique 위반의 «판정 근거»다
 // (`src/db/unique-violation.ts`) — Fake 도 진짜와 같은 모양이어야 한다.
 Object.assign(driverError, { code: "23505" });
 const fake = fakeExecutor([failsWith("update", driverError)]);

 const error = await rejection(
 updateProject(
 {
 workspaceId: WORKSPACE,
 projectId: "p-erp",
 input: input({ name: "ERP", slug: "smil" }),
 },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("CONFLICT");
 const message = isAppError(error) ? error.message : String(error);
 expect(message).not.toContain("duplicate key");
 expect(message).not.toContain("projects_workspace_slug_unique");
 });

 /**
 * 🔴 **unique 위반«일 때만» CONFLICT 다.**
 *
 * 무엇이 오든 `CONFLICT` 로 접으면 접속 끊김·statement timeout·Pool 고갈까지
 * 「같은 slug 가 이미 있습니다」로 둔갑한다. 사용자는 멀쩡한 이름을 계속 바꿔 가며
 * 다시 시도하고, 진짜 원인은 화면에도 로그에도 남지 않는다 — 무엇이든 접던 예전보다
 * 나쁜 과차단이다.
 *
 * ## 되돌림 확인
 *
 * `project-service.ts` 의 `if (isUniqueViolation(cause))` 를 지워 무조건
 * `AppError` 를 던지게 되돌리면 이 시험이 **실패한다** — 접속 끊김이 CONFLICT 가 된다.
 */
 it("🔴 unique 위반이 «아닌» 실패는 CONFLICT 로 뭉개지 않는다", async () => {
 const connectionLost = new Error("Connection terminated unexpectedly");
 Object.assign(connectionLost, { code: "57P01" });
 const fake = fakeExecutor([failsWith("update", connectionLost)]);

 const error = await rejection(
 updateProject(
 {
 workspaceId: WORKSPACE,
 projectId: "p-erp",
 input: input({ name: "ERP", slug: "smil" }),
 },
 fake.executor,
),
);

 // 되돌리면 여기서 AppError(CONFLICT) 가 된다 — 접속 장애가 이름 충돌로 보고된다.
 expect(isAppError(error)).toBe(false);
 expect(error).toBe(connectionLost);
 });
});

describe("deleteProject", () => {
 it("지울 대상이 없으면 NOT_FOUND 다 — 「지웠다」로 끝내지 않는다", async () => {
 const fake = fakeExecutor([deletes([])]);

 const error = await rejection(
 deleteProject(
 { workspaceId: OTHER_WORKSPACE, projectId: "p-smil" },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("NOT_FOUND");
 });
});

describe("resolveIngestProject — Agent 요청이 가리키는 Project", () => {
 it("Project 를 보내지 않으면 default 를 만든다", async () => {
 const fake = fakeExecutor([selects([]), inserts([{ id: "p-default" }])]);

 const projectId = await resolveIngestProject(
 { workspaceId: WORKSPACE, project: null },
 fake.executor,
);

 expect(projectId).toBe("p-default");
 expect(fake.calls[1]?.values?.slug).toBe("default");
 expect(fake.calls[1]?.values?.name).toBe("Default");
 });

 it("이미 있으면 만들지 않고 그것을 쓴다", async () => {
 const fake = fakeExecutor([selects([projectRow("smil")])]);

 const projectId = await resolveIngestProject(
 { workspaceId: WORKSPACE, project: { slug: "smil", name: null } },
 fake.executor,
);

 expect(projectId).toBe("p-smil");
 expect(fake.calls).toHaveLength(1);
 });

 /**
 * 🔴 **Payload 가 Workspace 를 고르지 못한다**. 남의 Workspace 의 Project
 * slug 를 적어도 만들어지는 것은 **API Key 의 Workspace 안에** 있는 Project 다.
 *
 * 조회가 실제로 남의 것을 걸러 내는지는 SQL 조건이 하는 일이라
 * `project.integration.test.ts` 가 본다. 여기서는 **저장되는 `workspaceId` 가 Key 의 것**
 * 이라는 사실만 본다.
 */
 it("🔴 새로 만드는 Project 의 workspaceId 는 언제나 인자로 받은 값이다", async () => {
 const fake = fakeExecutor([selects([]), inserts([{ id: "p-beta" }])]);

 await resolveIngestProject(
 { workspaceId: OTHER_WORKSPACE, project: { slug: "smil", name: null } },
 fake.executor,
);

 expect(fake.calls[1]?.values?.workspaceId).toBe(OTHER_WORKSPACE);
 });

 it("slug 를 정규화한다 — Agent 가 보낸 문자열이 그대로 주소가 되지 않는다", async () => {
 const fake = fakeExecutor([selects([]), inserts([{ id: "p" }])]);

 await resolveIngestProject(
 { workspaceId: WORKSPACE, project: { slug: "My Project!!", name: null } },
 fake.executor,
);

 expect(fake.calls[1]?.values?.slug).toBe("my-project");
 });

 /**
 * 🔴 이 함수는 **Review 저장 Transaction 안에서** 돈다. 동시에 들어온 두 요청 중 진 쪽이
 * 예외를 던지면 그 Review 가 통째로 날아간다 — 그래서 `onConflictDoNothing` 뒤에 다시 읽는다.
 */
 it("🔴 동시에 들어와 삽입에서 지면 다시 읽어 그 Project 를 쓴다", async () => {
 const fake = fakeExecutor([
 selects([]),
 inserts([]),
 selects([projectRow("smil")]),
 ]);

 const projectId = await resolveIngestProject(
 { workspaceId: WORKSPACE, project: { slug: "smil", name: null } },
 fake.executor,
);

 expect(projectId).toBe("p-smil");
 });

 it("다시 읽어도 없으면 INTERNAL_ERROR 다 — 조용히 넘어가지 않는다", async () => {
 const fake = fakeExecutor([selects([]), inserts([]), selects([])]);

 const error = await rejection(
 resolveIngestProject(
 { workspaceId: WORKSPACE, project: { slug: "smil", name: null } },
 fake.executor,
),
);

 expect(isAppError(error) && error.code).toBe("INTERNAL_ERROR");
 });
});
