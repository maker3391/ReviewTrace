import { describe, expect, it } from "vitest";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/db";
import { deletes, fakeExecutor, selects } from "@/db/testing/fake-executor";
import { deleteAccount } from "@/features/users/server/account-deletion-service";
import { isAppError } from "@/lib/errors";

/**
 * 계정 삭제의 **판정 규칙** — Database 없이 돈다.
 *
 * ## 여기서 보는 것
 *
 * 「마지막 OWNER 인가」를 **어느 시점의 사실로** 판단하는가. 그것은 행을 돌려받은 뒤의
 * 순수한 판단이라 Fake 로 결정적으로 시험할 수 있다.
 *
 * ## 🔴 여기서 볼 수 «없는» 것
 *
 * `FOR UPDATE` 가 실제로 무엇을 잠그는가, 두 Transaction 이 정말 줄을 서는가 —
 * 그것은 `account-deletion.integration.test.ts` 가 실제 PostgreSQL 로 본다.
 * 이 파일이 붙드는 것은 **잠근 뒤의 값을 쓰는가**와 **잠그는 순서**뿐이다.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const WORKSPACE = "33333333-3333-4333-8333-333333333333";

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

/** 계정 행. 삭제는 여기서 시작한다. */
const account = () => selects([{ id: USER, email: "me@example.test" }]);

/**
 * 잠그기 «전»에 읽은 내 소속 목록. 🔴 이 행의 `role` 은 낡을 수 있다.
 *
 * `personalOwnerId` 를 남으로 두어 Personal 이 아닌 Workspace 로 만든다 —
 * 그래야 남는 경로에서 slug 회전이 끼어들지 않아 호출 수가 흔들리지 않는다.
 */
const staleList = (role: "OWNER" | "MEMBER") =>
  selects([
    {
      workspaceId: WORKSPACE,
      slug: "acme",
      name: "Acme",
      personalOwnerId: OTHER,
      role,
    },
  ]);

/** 잠근 Workspace 행. */
const lockedWorkspaces = () => selects([{ id: WORKSPACE }]);

/**
 * 잠근 뒤에 «다시» 읽은 내 소속 목록 — 목록이 늘지 않았는지 확인하는 조회다(2-1 단계).
 *
 * 🔴 이 조회가 빠지면 잠그기 전에 만들어진 Workspace 를 놓쳐 멤버 0명의 행이 남는다.
 */
const recheckedList = () =>
  selects([
    {
      workspaceId: WORKSPACE,
      slug: "acme",
      name: "Acme",
      personalOwnerId: OTHER,
      role: "OWNER" as const,
    },
  ]);

/** 잠근 뒤에 다시 읽은 소속 행 전부 — 내 것과 남의 것이 함께 온다. */
const lockedMembers = (mine: "OWNER" | "MEMBER", theirs: "OWNER" | "MEMBER") =>
  selects([
    { workspaceId: WORKSPACE, userId: USER, role: mine },
    { workspaceId: WORKSPACE, userId: OTHER, role: theirs },
  ]);

describe("deleteAccount — 마지막 OWNER 판정", () => {
  /**
   * # 🔴 낡은 역할과 갓 센 OWNER 수를 섞지 않는다
   *
   * ## 무엇이 깨져 있었는가
   *
   * 판정에 쓰는 두 값이 **서로 다른 시점**의 것이었다 —
   *
   * ```
   * role         잠그기 «전» 조회에서 왔다   (낡았다)
   * otherOwners  잠근 «뒤» 조회에서 왔다     (최신이다)
   * ```
   *
   * A=MEMBER · B=OWNER 로 시작해 A 의 삭제가 첫 조회 직후 멈추고, 그 사이 B 가 A 를
   * OWNER 로 올린 뒤 자신을 MEMBER 로 내렸다고 하자. 다시 세면 `otherOwners = 0` 인데
   * 역할은 옛 `MEMBER` 라 `BLOCKED` 분기를 **비껴간다** — 삭제가 통과하고
   * **OWNER 가 0명인 Workspace** 가 남는다. 남은 사람들은 초대도 설정 변경도 API Key
   * 발급도 영원히 못 하고, 화면에 되돌릴 방법이 없다.
   *
   * ## 🔴 되돌림 확인
   *
   * `readMembershipFacts` 의 잠근 뒤 `role` 을 다시 낡은 `row.role` 로 되돌리면 이
   * 시험이 실패한다(삭제가 그대로 통과한다).
   */
  it("🔴 잠근 뒤 OWNER 로 «올라간» 나를 마지막 OWNER 로 본다", async () => {
    const fake = fakeExecutor([
      // 읽을 때는 MEMBER 였다.
      staleList("MEMBER"),
      lockedWorkspaces(),
      account(),
      // 2-1. 잠근 뒤 재조회 — 늘지 않았다.
      recheckedList(),
      // 잠그고 보니 내가 OWNER 이고 남은 OWNER 는 없다.
      lockedMembers("OWNER", "MEMBER"),
    ]);

    const error = await rejection(
      deleteAccount({ userId: USER }, fake.executor),
    );

    expect(isAppError(error) && error.code).toBe("CONFLICT");
    // 🔴 아무것도 지우지 않았다.
    expect(fake.calls.every((call) => call.kind === "select")).toBe(true);
  });

  /**
   * 반대 방향도 같은 자리에서 갈린다 — 낡은 `OWNER` 를 그대로 쓰면 **지울 수 있는 계정이
   * 영영 막힌다.** 사람이 스스로 풀 방법이 없다(이미 MEMBER 라 역할을 바꿀 권한이 없다).
   */
  it("🔴 잠근 뒤 MEMBER 로 «내려간» 나는 더 이상 마지막 OWNER 가 아니다", async () => {
    const fake = fakeExecutor([
      // 읽을 때는 OWNER 였다.
      staleList("OWNER"),
      lockedWorkspaces(),
      account(),
      // 2-1. 잠근 뒤 재조회 — 늘지 않았다.
      recheckedList(),
      // 잠그고 보니 나는 MEMBER 다. 남은 OWNER 가 없어도 내가 막을 이유가 없다.
      lockedMembers("MEMBER", "MEMBER"),
      // 남는 Workspace 라 지우는 것은 초대·인증 Token·계정뿐이다.
      deletes(),
      deletes(),
      deletes(),
    ]);

    await deleteAccount({ userId: USER }, fake.executor);

    expect(fake.remaining()).toBe(0);
    // 🔴 Workspace 를 지우지 않았다 — 남는 Workspace 는 그대로다.
    expect(fake.calls.filter((call) => call.kind === "delete")).toHaveLength(3);
  });

  /**
   * 🔴 **잠근 뒤에 내가 그 Workspace 에서 빠졌다면 그것은 더 이상 내 것이 아니다.**
   * 그대로 지우면 남의 Workspace 를 날린다.
   */
  it("🔴 잠그는 사이에 내보내진 Workspace 는 판단 대상에서 빠진다", async () => {
    const fake = fakeExecutor([
      staleList("OWNER"),
      lockedWorkspaces(),
      account(),
      // 2-1. 잠근 뒤 재조회 — 늘지 않았다.
      recheckedList(),
      // 내 행이 없다.
      selects([{ workspaceId: WORKSPACE, userId: OTHER, role: "OWNER" }]),
      deletes(),
      deletes(),
      deletes(),
    ]);

    await deleteAccount({ userId: USER }, fake.executor);

    expect(fake.remaining()).toBe(0);
    expect(fake.calls.filter((call) => call.kind === "delete")).toHaveLength(3);
  });
});

/**
 * # 🔴 잠그는 순서는 `workspaces -> users -> workspace_members` 다
 *
 * ## 왜 Workspace 가 «먼저»인가
 *
 * `FOR UPDATE` 는 **잠글 때 이미 존재하는 행만** 잡는다. 소속 행만 잠그면 그 뒤에 INSERT
 * 되는 소속(초대 수락)은 어떤 잠금에도 걸리지 않는데, Workspace 를 지우면 CASCADE 가
 * **방금 들어온 사람의 소속과 그 Workspace 의 Knowledge 를 통째로** 지운다.
 *
 * ## 🔴 왜 `users` 가 «Workspace 다음»인가 — 실제로 난 deadlock
 *
 * 예전에는 존재 확인을 겸해 `users` 를 **가장 먼저** 잠갔다. 그런데 초대 수락은
 * `workspaces` 를 먼저 잠그고 `accepted_by` 를 쓰면서 FK 로 `users` 를 잠근다 —
 * 두 경로가 `users -> workspaces` 대 `workspaces -> users` 로 **엇갈렸다.**
 * 같은 사용자로 동시에 돌리자 실제 PostgreSQL 이 `40P01 deadlock detected` 를 냈다.
 *
 * 🔴 그래서 여기서 붙드는 것은 「Workspace 가 먼저」만이 아니라 **세 문장의 순서 전체**다.
 * 순서를 하나라도 바꾸면 이 시험이 빨개진다. 실제로 잠기는지·정말 줄을 서는지는
 * `account-deletion.integration.test.ts` 가 실제 연결 둘로 본다.
 */
describe("deleteAccount — 잠그는 순서", () => {
  it("🔴 workspaces -> users -> workspace_members 순으로 잠근다", async () => {
    const order: string[] = [];

    function lockingSelect(rows: unknown[], label: string, expectSql?: string) {
      return {
        from: () => ({
          where: (condition: SQL) => {
            const rendered = new PgDialect().sqlToQuery(condition).sql;
            const chain = {
              limit: () => chain,
              orderBy: () => chain,
              innerJoin: () => chain,
              for: (strength: string) => {
                order.push(`${label}:${strength}`);
                if (expectSql !== undefined) {
                  expect(rendered).toContain(expectSql);
                }
                return chain;
              },
              then: (...args: Parameters<Promise<unknown[]>["then"]>) =>
                Promise.resolve(rows).then(...args),
            };
            return chain;
          },
        }),
      };
    }

    const scripted = [
      // 0. 잠글 대상을 고르는 조회 — 🔴 `for` 를 부르지 않는다(아무것도 잠그지 않는다).
      {
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () =>
                Promise.resolve([
                  {
                    workspaceId: WORKSPACE,
                    slug: "acme",
                    name: "Acme",
                    personalOwnerId: OTHER,
                    role: "OWNER" as const,
                  },
                ]),
            }),
          }),
        }),
      },
      lockingSelect(
        [{ id: WORKSPACE }],
        "lock-workspaces",
        '"workspaces"."id"',
      ),
      lockingSelect(
        [{ id: USER, email: "me@example.test" }],
        "lock-user",
        '"users"."id"',
      ),
      // 2-1. 잠근 뒤 재조회 — 🔴 `for` 를 부르지 않는다(아무것도 잠그지 않는다).
      {
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () =>
                Promise.resolve([
                  {
                    workspaceId: WORKSPACE,
                    slug: "acme",
                    name: "Acme",
                    personalOwnerId: OTHER,
                    role: "OWNER" as const,
                  },
                ]),
            }),
          }),
        }),
      },
      lockingSelect(
        [
          { workspaceId: WORKSPACE, userId: USER, role: "MEMBER" as const },
          { workspaceId: WORKSPACE, userId: OTHER, role: "OWNER" as const },
        ],
        "lock-members",
        '"workspace_members"."workspace_id"',
      ),
    ];

    let step = 0;
    const executor = {
      select: () => scripted[step++],
      delete: () => ({ where: () => Promise.resolve([]) }),
      transaction: <T>(run: (tx: DbExecutor) => Promise<T>): Promise<T> =>
        run(executor as unknown as DbExecutor),
    } as unknown as DbExecutor;

    await deleteAccount({ userId: USER }, executor);

    expect(order).toEqual([
      "lock-workspaces:update",
      "lock-user:update",
      "lock-members:update",
    ]);
  });
});
