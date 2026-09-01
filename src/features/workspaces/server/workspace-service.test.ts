import { describe, expect, it } from "vitest";

import {
  fakeExecutor,
  inserts,
  selects,
  updates,
} from "@/db/testing/fake-executor";
import {
  changeMemberRole,
  createWorkspace,
} from "@/features/workspaces/server/workspace-service";
import { isAppError } from "@/lib/errors";

/**
 * Workspace 만들기와 멤버 역할의 **판정 규칙** — Database 없이 돈다.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 「마지막 OWNER 를 강등하지 않는다」는 **되돌릴 방법이 화면에 없는** 규칙이다. 그 규칙을
 * 지키는 코드의 시험이 `project.integration.test.ts` 에만 있어, `DB_INTEGRATION=true` 를
 * 주지 않는 기본 실행에서는 검사를 통째로 지워도 초록이었다.
 *
 * ## 여기서 보지 «않는» 것
 *
 * `FOR UPDATE` 가 실제로 행을 잠그는가 — 두 요청이 서로를 동시에 강등하려 할 때 둘 다
 * 통과하지 않는가. 그것은 Transaction 이 지키는 것이라 통합시험에 남는다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("changeMemberRole — 잠기지 않게 막는다", () => {
  /**
   * 🔴 되돌림 확인(2026-08-29): `personal[0]?.personalOwnerId === input.userId` 분기를 지우면
   * 이 시험이 실패한다(거절되지 않고 UPDATE 까지 간다). 직접 지워 보고 되돌렸다.
   */
  it("🔴 Personal Workspace 의 주인은 역할을 바꿀 수 없다", async () => {
    const fake = fakeExecutor([selects([{ personalOwnerId: ME }])]);

    const error = await rejection(
      changeMemberRole(
        { workspaceId: WORKSPACE, userId: ME, role: "MEMBER" },
        fake.executor,
      ),
    );

    expect(isAppError(error) && error.code).toBe("CONFLICT");
    // UPDATE 까지 가지 않았다.
    expect(fake.calls).toHaveLength(1);
  });

  /**
   * 🔴 되돌림 확인(2026-08-29): `if (others.length === 0)` 블록을 지우면 이 시험이 실패한다.
   */
  it("🔴 다른 OWNER 가 없으면 강등하지 않는다 — Workspace 가 잠긴다", async () => {
    /*
     * 🔴 **잠금 문장이 하나로 합쳐졌다**(2026-08-31). 예전에는 「다른 OWNER 를 세는
     * select」와 「대상을 바꾸는 update」가 두 걸음이었는데, 그 사이에 순서가 없어
     * `removeMember` 와 엇갈리면 실제로 `40P01 deadlock detected` 가 났다. 지금은 대상
     * 행과 OWNER 행을 **한 문장**으로 잠그므로, 이 시험이 넘겨주는 행에도 **대상이 함께
     * 들어 있어야 한다** — 그 문장이 둘을 같이 읽기 때문이다.
     */
    const fake = fakeExecutor([
      selects([{ personalOwnerId: null }]),
      selects([{ userId: ME, role: "OWNER" }]),
    ]);

    const error = await rejection(
      changeMemberRole(
        { workspaceId: WORKSPACE, userId: ME, role: "MEMBER" },
        fake.executor,
      ),
    );

    expect(isAppError(error) && error.code).toBe("CONFLICT");
    expect(fake.calls).toHaveLength(2);
  });

  it("다른 OWNER 가 있으면 강등한다", async () => {
    const fake = fakeExecutor([
      selects([{ personalOwnerId: null }]),
      selects([
        { userId: ME, role: "OWNER" },
        { userId: OTHER, role: "OWNER" },
      ]),
      updates([{ userId: ME }]),
    ]);

    await changeMemberRole(
      { workspaceId: WORKSPACE, userId: ME, role: "MEMBER" },
      fake.executor,
    );

    expect(fake.calls[2]?.values?.role).toBe("MEMBER");
  });

  /**
   * 🔴 잠금 문장은 이제 **올릴 때도** 돈다(순서를 한 곳에서 정하려면 그래야 한다).
   * 그러나 «세는» 일은 여전히 강등에만 있다 — 잠긴 행에 다른 OWNER 가 하나도 없어도
   * 올리는 것은 통과한다.
   */
  it("OWNER 로 «올리는» 것은 OWNER 수를 세지 않는다 — 잠길 일이 없다", async () => {
    const fake = fakeExecutor([
      selects([{ personalOwnerId: null }]),
      selects([{ userId: OTHER, role: "MEMBER" }]),
      updates([{ userId: OTHER }]),
    ]);

    await changeMemberRole(
      { workspaceId: WORKSPACE, userId: OTHER, role: "OWNER" },
      fake.executor,
    );

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]?.values?.role).toBe("OWNER");
  });

  /** 🔴 잠근 행에 대상이 없으면 **UPDATE 까지 가지 않고** 거절한다. */
  it("바꿀 멤버가 없으면 NOT_FOUND 다", async () => {
    const fake = fakeExecutor([
      selects([{ personalOwnerId: null }]),
      selects([{ userId: OTHER, role: "OWNER" }]),
    ]);

    const error = await rejection(
      changeMemberRole(
        { workspaceId: WORKSPACE, userId: ME, role: "MEMBER" },
        fake.executor,
      ),
    );

    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });
});

describe("createWorkspace", () => {
  it("이름이 비면 Database 를 보지도 않고 거절한다", async () => {
    const fake = fakeExecutor([]);

    const error = await rejection(
      createWorkspace({ name: " ", createdBy: ME }, fake.executor),
    );

    expect(isAppError(error) && error.code).toBe("VALIDATION_ERROR");
    expect(fake.calls).toHaveLength(0);
  });

  /**
   * 🔴 Workspace 와 소속이 **함께** 만들어져야 한다. 「Workspace 는 있는데 소속이 없는」
   * 반쪽 상태가 남으면 만든 사람이 자기 Workspace 에 들어가지 못한다.
   *
   * 🔴 `personalOwnerId` 를 **채우지 않는다.** 채우면 그 사람의 Personal Workspace 자리를
   * 뺏어 가입 흐름이 어긋난다.
   */
  it("🔴 만든 사람이 OWNER 로 함께 들어가고 Personal 자리를 뺏지 않는다", async () => {
    const fake = fakeExecutor([inserts([{ id: "w1" }]), inserts([])]);

    const created = await createWorkspace(
      { name: "CodeApex", createdBy: ME },
      fake.executor,
    );

    expect(created.slug).toBe("codeapex");
    expect(fake.calls[0]?.values?.createdBy).toBe(ME);
    expect(fake.calls[0]?.values).not.toHaveProperty("personalOwnerId");
    expect(fake.calls[1]?.values?.role).toBe("OWNER");
    expect(fake.calls[1]?.values?.userId).toBe(ME);
  });

  it("slug 가 겹치면 다음 후보로 넘어간다", async () => {
    const fake = fakeExecutor([
      inserts([]),
      inserts([{ id: "w2" }]),
      inserts([]),
    ]);

    const created = await createWorkspace(
      { name: "CodeApex", createdBy: ME },
      fake.executor,
    );

    expect(created.slug).toBe("codeapex-2");
  });

  /**
   * 🔴 실패 message 에 **사용자가 넣은 값을 담지 않는다** — 그 문자열이 화면과 로그로
   * 흘러 나간다.
   */
  it("🔴 후보를 다 써도 실패하면 CONFLICT 이고 message 에 이름이 없다", async () => {
    const fake = fakeExecutor([
      inserts([]),
      inserts([]),
      inserts([]),
      inserts([]),
      inserts([]),
    ]);

    const error = await rejection(
      createWorkspace({ name: "CodeApex", createdBy: ME }, fake.executor),
    );

    expect(isAppError(error) && error.code).toBe("CONFLICT");
    const message = isAppError(error) ? error.message : String(error);
    expect(message).not.toContain("CodeApex");
    expect(message).not.toContain("codeapex");
  });
});
