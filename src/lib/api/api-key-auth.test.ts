import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbExecutor } from "@/db";
import { authenticateAgent } from "@/lib/api/api-key-auth";
import { generateAgentCredential } from "@/lib/api/api-key-token";
import { isAppError } from "@/lib/errors";
import type { AgentPrincipalType, AgentReviewLanguage } from "@/types/agent";

/**
 * Agent 요청의 자격 판정.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 폐기·만료 검사를 **통째로 지워도 `pnpm test` 가 초록이었다.** 「자격을 폐기하면 그 즉시
 * 막힌다」는 것이 이 제품의 약속인데, 그 약속을 지키는 코드에 시험이 하나도 없었다.
 *
 * ## 🔴 DB 없이 돈다
 *
 * `authenticateAgent` 가 `executor` 를 인자로 받으므로 Fake 하나면 충분하다 —
 * 여기서 확인하려는 것은 **판정 규칙**이지 SQL 이 아니다. 실제 PostgreSQL 을 쓰는
 * 시험은 기본 실행에서 건너뛰게 되어, 정작 매번 돌아야 할 이 규칙이 안 돌게 된다.
 *
 * ## 🔴 자격은 `ci_agent_` 하나뿐이다
 *
 * 예전의 Workspace API Key(`ci_`)는 발급도 인증도 걷어냈다. 그 모양은 이제
 * **Database 를 보지도 않고** 거절된다 — 아래 「형식이 아닌 값」이 그것을 잡는다.
 */

interface FakeCredentialRow {
  id: string;
  principalId: string;
  capabilityScopes: string[];
  expiresAt: Date | null;
  credentialRevokedAt: Date | null;
  principalType: AgentPrincipalType;
  ownerUserId: string | null;
  /** `agent_credentials.name` — 사람이 그 연결에 붙인 이름. */
  name: string;
  /** `agent_principals.display_name` — 사람 한 명당 하나라 Agent 를 구별하지 못한다. */
  displayName: string;
  reviewLanguage: AgentReviewLanguage;
  principalRevokedAt: Date | null;
}

/**
 * `select … limit(1)` · `select … where(…)` · `update … where(…)` 만 흉내 내는 최소 Fake.
 *
 * 🔴 **조건절을 검사하지 않는다.** 그것은 Drizzle 의 일이고, 여기서 보려는 것은
 * 「어떤 행을 받았을 때 통과시키는가」다. 첫 `select` 는 자격 조회, 그 뒤는 Workspace
 * 허용 목록 조회다 — 실제 구현의 호출 순서와 같다.
 */
function fakeExecutor(
  credentials: FakeCredentialRow[],
  grants: { workspaceId: string }[] = [],
  onUpdate?: (values: Record<string, unknown>) => void,
): DbExecutor {
  let selects = 0;

  return {
    select: () => {
      selects += 1;
      const rows: unknown[] = selects === 1 ? credentials : grants;
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
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

const KEY = generateAgentCredential();

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const row = (over: Partial<FakeCredentialRow> = {}): FakeCredentialRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  principalId: "33333333-3333-4333-8333-333333333333",
  capabilityScopes: ["READ", "WRITE"],
  expiresAt: null,
  credentialRevokedAt: null,
  principalType: "USER_AGENT",
  ownerUserId: "44444444-4444-4444-8444-444444444444",
  name: "codex-ci",
  /*
   🔴 **일부러 다르게 둔다.** 둘을 같게 두면 `actorName` 이 어느 칸을 읽는지
   시험이 구별하지 못해, principal 을 읽는 예전 구현으로 되돌려도 초록이다.
   */
  displayName: "ReviewTrace Agent",
  reviewLanguage: "ko",
  principalRevokedAt: null,
  ...over,
});

const grants = [{ workspaceId: WORKSPACE_ID }];

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
  it("살아 있는 자격은 허용된 Workspace 집합을 돌려준다", async () => {
    const agent = await authenticateAgent(
      requestWith(`Bearer ${KEY.plainToken}`),
      fakeExecutor([row()], grants),
    );

    expect(agent.authorizedWorkspaceIds).toEqual([WORKSPACE_ID]);
    expect(agent.credentialId).toBe("11111111-1111-4111-8111-111111111111");
    expect(agent.principalId).toBe("33333333-3333-4333-8333-333333333333");
    expect(agent.actorName).toBe("codex-ci");
    expect(agent.capabilities).toEqual(["READ", "WRITE"]);
    expect(agent.reviewLanguage).toBe("ko");
  });

  /**
   * 🔴 **행위자 이름은 «그 연결»의 이름이지 principal 의 이름이 아니다.**
   *
   * 이 값은 `review_sessions.reviewer_name` · `issue_activities.actor_name` 으로
   * 그대로 박힌다. principal 을 읽으면 한 사람이 만든 모든 연결이 같은
   * 이름으로 뭉개져, 화면의 「리뷰어」 열이 codex 와 claude-code 를 구별하지
   * 못한다 — 실제로 `ReviewTrace Agent` 가 모든 행에 박혔다.
   */
  it("행위자 이름은 credential 의 이름이다 — principal 의 display name 이 아니다", async () => {
    const agent = await authenticateAgent(
      requestWith(`Bearer ${KEY.plainToken}`),
      fakeExecutor(
        [row({ name: "claude-code-mcp", displayName: "ReviewTrace Agent" })],
        grants,
      ),
    );

    expect(agent.actorName).toBe("claude-code-mcp");
    expect(agent.actorName).not.toBe("ReviewTrace Agent");
  });

  /**
   * 🔴 **같은 사람의 연결 둘은 서로 다른 행위자다.** USER_AGENT principal 은
   * owner 당 하나라(`agent_principals_active_user_owner_unique`) principal 을 읽으면
   * 이 둘이 구별되지 않는다 — 그것이 바로 이번 회귀의 모양이다.
   */
  it("principal 이 같아도 연결이 다르면 행위자가 다르다", async () => {
    const principal = {
      principalId: "33333333-3333-4333-8333-333333333333",
      displayName: "ReviewTrace Agent",
    };

    const codex = await authenticateAgent(
      requestWith(`Bearer ${KEY.plainToken}`),
      fakeExecutor([row({ ...principal, name: "codex-cli" })], grants),
    );
    const claude = await authenticateAgent(
      requestWith(`Bearer ${KEY.plainToken}`),
      fakeExecutor([row({ ...principal, name: "claude-code-mcp" })], grants),
    );

    expect(codex.principalId).toBe(claude.principalId);
    expect(codex.actorName).not.toBe(claude.actorName);
    expect([codex.actorName, claude.actorName]).toEqual([
      "codex-cli",
      "claude-code-mcp",
    ]);
  });
  it("만료가 «미래»면 통과한다", async () => {
    const later = new Date(Date.now() + 60 * 60 * 1000);

    await expect(
      authenticateAgent(
        requestWith(`Bearer ${KEY.plainToken}`),
        fakeExecutor([row({ expiresAt: later })], grants),
      ),
    ).resolves.toMatchObject({ actorName: "codex-ci" });
  });

  /** 🔴 저장된 값 중 실제 Capability 가 아닌 것은 걸러 낸다 — 권한이 늘지 않는다. */
  it("READ 만 가진 자격은 WRITE 를 얻지 못한다", async () => {
    const agent = await authenticateAgent(
      requestWith(`Bearer ${KEY.plainToken}`),
      fakeExecutor([row({ capabilityScopes: ["READ", "ADMIN"] })], grants),
    );

    expect(agent.capabilities).toEqual(["READ"]);
  });

  /** 🔴 허용된 Workspace 가 하나도 없어도 인증 자체는 통과한다 — 범위가 빌 뿐이다. */
  it("허용된 Workspace 가 없으면 빈 집합이다", async () => {
    const agent = await authenticateAgent(
      requestWith(`Bearer ${KEY.plainToken}`),
      fakeExecutor([row()], []),
    );

    expect(agent.authorizedWorkspaceIds).toEqual([]);
  });

  it("lastUsedAt 을 찍는다 — 「마지막으로 쓰인 때」를 보여 주기 위한 값이다", async () => {
    const updates: Record<string, unknown>[] = [];

    await authenticateAgent(
      requestWith(`Bearer ${KEY.plainToken}`),
      fakeExecutor([row()], grants, (values) => updates.push(values)),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]?.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("authenticateAgent — 거절", () => {
  /**
   * 🔴 되돌림 확인(2026-08-29): `api-key-auth.ts` 의 `credentialRevokedAt !== null` 을
   * 지우면 이 시험이 실패한다.
   */
  it("🔴 폐기된 자격은 거절한다 — 폐기는 «그 즉시» 듣는다", async () => {
    const error = await rejection(
      authenticateAgent(
        requestWith(`Bearer ${KEY.plainToken}`),
        fakeExecutor(
          [row({ credentialRevokedAt: new Date("2026-01-01T00:00:00Z") })],
          grants,
        ),
      ),
    );

    expect(error).not.toBeNull();
    expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
  });

  /**
   * 🔴 **자격 하나가 아니라 그 주인이 통째로 거둬진 경우다.** 그 판정을 빼면
   * 폐기된 Agent 의 남은 자격이 계속 통과한다.
   */
  it("🔴 주인이 폐기됐으면 자격이 살아 있어도 거절한다", async () => {
    const error = await rejection(
      authenticateAgent(
        requestWith(`Bearer ${KEY.plainToken}`),
        fakeExecutor([row({ principalRevokedAt: new Date() })], grants),
      ),
    );

    expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
  });

  /**
   * 🔴 되돌림 확인(2026-08-29): `expiresAt` 검사를 지우면 이 시험이 실패한다.
   */
  it("🔴 만료된 자격은 거절한다", async () => {
    const past = new Date(Date.now() - 1000);

    const error = await rejection(
      authenticateAgent(
        requestWith(`Bearer ${KEY.plainToken}`),
        fakeExecutor([row({ expiresAt: past })], grants),
      ),
    );

    expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
  });

  it("없는 자격은 거절한다", async () => {
    const error = await rejection(
      authenticateAgent(
        requestWith(`Bearer ${KEY.plainToken}`),
        fakeExecutor([], grants),
      ),
    );

    expect(isAppError(error) && error.code).toBe("UNAUTHORIZED");
  });

  it("헤더가 없으면 Database 를 보지도 않고 거절한다", async () => {
    let looked = false;
    const executor = fakeExecutor([row()], grants);
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

  /**
   * 🔴 **걷어낸 `ci_` Workspace Key 도 여기서 걸린다.** 형식 단계에서 떨어지므로
   * Database 를 보지 않는다 — 인증 경로가 사라졌다는 것이 여기서 확인된다.
   */
  it("형식이 아닌 값도 Database 를 보지 않고 거절한다", async () => {
    const headers = [
      "",
      "Bearer",
      "Bearer x",
      "Token ci_agent_abc",
      "ci_agent_abc",
      `Bearer ci_${"a".repeat(43)}`,
    ];

    for (const header of headers) {
      let looked = false;
      const executor = fakeExecutor([row()], grants);
      const spy = new Proxy(executor, {
        get(target, prop) {
          if (prop === "select") looked = true;
          return Reflect.get(target, prop);
        },
      }) as DbExecutor;

      const error = await rejection(authenticateAgent(requestWith(header), spy));

      expect(isAppError(error) && error.code, header).toBe("UNAUTHORIZED");
      expect(looked, header).toBe(false);
    }
  });

  /**
   * 🔴 **거절 사유를 구분해 알려 주지 않는다**.
   *
   * 구분해 주면 그것만으로 「이 자격은 존재한다」·「이 자격은 폐기됐다」가 새어 나가고,
   * 값을 훑어 유효한 자격을 좁혀 갈 수 있게 된다.
   */
  it("🔴 네 가지 거절이 «구분되지 않는다» — 사유가 새지 않는다", async () => {
    const cases = [
      fakeExecutor([], grants), // 없는 자격
      fakeExecutor([row({ credentialRevokedAt: new Date() })], grants), // 폐기
      fakeExecutor([row({ expiresAt: new Date(Date.now() - 1000) })], grants), // 만료
    ];

    const errors = await Promise.all(
      cases.map((executor) =>
        rejection(
          authenticateAgent(requestWith(`Bearer ${KEY.plainToken}`), executor),
        ),
      ),
    );
    errors.push(
      await rejection(authenticateAgent(requestWith(), fakeExecutor([]))),
    );

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
      fakeExecutor([row()], grants),
    );

    const serialized = JSON.stringify(agent);
    expect(serialized).not.toContain(KEY.plainToken);
    expect(serialized).not.toContain(KEY.keyHash);
    // 🔴 표시 이름은 Activity 의 행위자로 쓰인다 — 그것만 나간다.
    expect(Object.keys(agent).sort()).toEqual([
      "actorName",
      "authorizedWorkspaceIds",
      "capabilities",
      "credentialId",
      "principalId",
      "principalType",
      "reviewLanguage",
    ]);
  });

  it("🔴 거절 message 에 받은 값을 되돌려 담지 않는다", async () => {
    const error = await rejection(
      authenticateAgent(
        requestWith(`Bearer ${KEY.plainToken}`),
        fakeExecutor([], grants),
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
        fakeExecutor([row({ credentialRevokedAt: new Date() })], grants),
      ),
    );

    expect(logged.join("\n")).not.toContain(KEY.plainToken);
    expect(logged.join("\n")).not.toContain(KEY.keyHash);
  });
});
