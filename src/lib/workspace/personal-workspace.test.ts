import { describe, expect, it } from "vitest";

import { fakeExecutor, inserts, selects } from "@/db/testing/fake-executor";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 가입이 부르는 자리의 **판정 규칙** — Database 없이 돈다.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 가입은 **실패하면 안 되는 경로**다. 그 규칙(이미 있으면 다시 만들지 않는다 · slug 가
 * 겹치면 다음 후보로 간다 · 경쟁에서 지면 이미 만들어진 것을 쓴다)이
 * `workspace.integration.test.ts` 에만 있었고, 그 파일은 기본 `pnpm test` 에서 건너뛴다.
 *
 * ## 여기서 보지 «않는» 것
 *
 * `workspaces.personal_owner_id` 의 unique 가 실제로 걸려 있는가 — 「두 창에서 동시에
 * 로그인해도 하나뿐」의 **최종 방어선**은 그 제약이지 이 코드가 아니다. 통합시험에 남는다.
 */

const USER = "22222222-2222-4222-8222-222222222222";

describe("ensurePersonalWorkspace", () => {
  it("이미 있으면 만들지 않고 그것을 돌려준다", async () => {
    const fake = fakeExecutor([selects([{ id: "w-existing" }])]);

    const workspaceId = await ensurePersonalWorkspace(
      { userId: USER, displayName: "Octocat", slugSource: "octocat" },
      fake.executor,
    );

    expect(workspaceId).toBe("w-existing");
    expect(fake.calls).toHaveLength(1);
  });

  /**
   * 🔴 Workspace 와 소속을 **함께** 만든다. 반쪽 상태가 남으면 그 사람은 자기 Workspace 에
   * 들어가지도, 새로 만들지도 못한다.
   */
  it("🔴 Workspace 와 OWNER 소속이 함께 만들어지고 주인이 박힌다", async () => {
    const fake = fakeExecutor([
      selects([]),
      inserts([{ id: "w1" }]),
      inserts([]),
    ]);

    const workspaceId = await ensurePersonalWorkspace(
      { userId: USER, displayName: "Octocat", slugSource: "octocat" },
      fake.executor,
    );

    expect(workspaceId).toBe("w1");
    expect(fake.calls[1]?.values?.slug).toBe("octocat");
    expect(fake.calls[1]?.values?.personalOwnerId).toBe(USER);
    expect(fake.calls[2]?.values?.role).toBe("OWNER");
    expect(fake.calls[2]?.values?.userId).toBe(USER);
  });

  it("slug 가 겹치면 다음 후보로 넘어간다 — 가입이 실패하지 않는다", async () => {
    const fake = fakeExecutor([
      selects([]),
      inserts([]), // slug 가 겹쳤다
      selects([]), // 경쟁에서 진 것은 아니다
      inserts([{ id: "w2" }]),
      inserts([]),
    ]);

    const workspaceId = await ensurePersonalWorkspace(
      { userId: USER, displayName: "Octocat", slugSource: "octocat" },
      fake.executor,
    );

    expect(workspaceId).toBe("w2");
    expect(fake.calls[3]?.values?.slug).toBe("octocat-2");
  });

  /**
   * 🔴 삽입이 비어 돌아오는 이유는 둘이다 — slug 가 겹쳤거나, **이미 내 Personal 이
   * 만들어졌거나.** 뒤쪽이면 다음 slug 를 시도할 이유가 없다. 시도하면 같은 사람에게
   * Workspace 가 둘 생길 뻔한다.
   */
  it("🔴 경쟁에서 지면 새 slug 를 시도하지 않고 이미 만들어진 것을 쓴다", async () => {
    const fake = fakeExecutor([
      selects([]),
      inserts([]),
      selects([{ id: "w-raced" }]),
    ]);

    const workspaceId = await ensurePersonalWorkspace(
      { userId: USER, displayName: "Octocat", slugSource: "octocat" },
      fake.executor,
    );

    expect(workspaceId).toBe("w-raced");
    expect(fake.calls).toHaveLength(3);
  });

  it("slug 재료가 하나도 없어도 가입이 막히지 않는다", async () => {
    const fake = fakeExecutor([
      selects([]),
      inserts([{ id: "w1" }]),
      inserts([]),
    ]);

    await ensurePersonalWorkspace(
      { userId: USER, displayName: null, slugSource: null },
      fake.executor,
    );

    expect(fake.calls[1]?.values?.slug).toBe("workspace");
  });

  /**
   * 🔴 오류 message 에 **사용자 이름을 담지 않는다** — 로그로 흘러 나간다.
   */
  it("🔴 후보를 다 써도 실패하면 message 에 이름이 없다", async () => {
    const fake = fakeExecutor([
      selects([]),
      ...[0, 1, 2, 3, 4].flatMap(() => [inserts([]), selects([])]),
    ]);

    let message = "";
    try {
      await ensurePersonalWorkspace(
        { userId: USER, displayName: "Octocat", slugSource: "octocat" },
        fake.executor,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("octocat");
    expect(message).not.toContain("Octocat");
  });
});
