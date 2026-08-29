import { describe, expect, it } from "vitest";
import type { Adapter, AdapterAccount } from "next-auth/adapters";

import {
  stripAccountCredentials,
  withoutStoredCredentials,
} from "@/lib/auth/account-credentials";

/**
 * **GitHub OAuth Credential 을 Database 에 저장하지 않는다**는 정책의 시험.
 *
 * 🔴 여기서 보는 것은 **Adapter 에 무엇이 넘어가는가** 다. 실제로 `accounts` 행에
 * 무엇이 남는지는 Fake 로 증명되지 않는다 —
 * `account-credentials.integration.test.ts` 가 실제 PostgreSQL 에서 그것을 본다.
 */

/** GitHub 콜백이 넘기는 모양. Token 값은 시험용 더미다. */
function githubAccount(): AdapterAccount {
  return {
    userId: "user-1",
    type: "oauth",
    provider: "github",
    providerAccountId: "12345678",
    access_token: "gho_test_access_value",
    refresh_token: "ghr_test_refresh_value",
    expires_at: 1_900_000_000,
    token_type: "bearer",
    scope: "read:user,user:email",
  };
}

/** `linkAccount` 가 받은 객체를 그대로 붙잡아 두는 Adapter. */
function recordingAdapter(): {
  adapter: Adapter;
  linked: AdapterAccount[];
} {
  const linked: AdapterAccount[] = [];

  return {
    linked,
    adapter: {
      linkAccount: async (account) => {
        linked.push(account);
      },
    },
  };
}

describe("stripAccountCredentials", () => {
  it("access_token 을 남기지 않는다", () => {
    expect(stripAccountCredentials(githubAccount())).not.toHaveProperty(
      "access_token",
    );
  });

  it("refresh_token 을 남기지 않는다", () => {
    expect(stripAccountCredentials(githubAccount())).not.toHaveProperty(
      "refresh_token",
    );
  });

  it("신원 칸은 그대로 둔다 — 없으면 다음 로그인에 사용자를 찾지 못한다", () => {
    const stripped = stripAccountCredentials(githubAccount());

    expect(stripped.provider).toBe("github");
    expect(stripped.providerAccountId).toBe("12345678");
    expect(stripped.userId).toBe("user-1");
    expect(stripped.type).toBe("oauth");
  });

  it("Credential 이 아닌 이력 정보는 지우지 않는다", () => {
    const stripped = stripAccountCredentials(githubAccount());

    expect(stripped.scope).toBe("read:user,user:email");
    expect(stripped.token_type).toBe("bearer");
  });

  it("원본 객체를 바꾸지 않는다 — 콜백은 그 Token 으로 GitHub 을 부른다", () => {
    const account = githubAccount();

    stripAccountCredentials(account);

    expect(account.access_token).toBe("gho_test_access_value");
  });
});

describe("withoutStoredCredentials", () => {
  it("Adapter 에 Credential 없는 Account 를 넘긴다", async () => {
    const { adapter, linked } = recordingAdapter();

    await withoutStoredCredentials(adapter).linkAccount?.(githubAccount());

    expect(linked).toHaveLength(1);
    expect(linked[0]).not.toHaveProperty("access_token");
    expect(linked[0]).not.toHaveProperty("refresh_token");
    expect(linked[0]?.providerAccountId).toBe("12345678");
  });

  it("linkAccount 가 없는 Adapter 는 그대로 돌려준다", () => {
    const adapter: Adapter = {};

    expect(withoutStoredCredentials(adapter)).toBe(adapter);
  });

  it("나머지 Adapter 동작은 그대로 흘려보낸다", async () => {
    const adapter: Adapter = {
      linkAccount: async () => {},
      getUserByAccount: async () => ({
        id: "user-1",
        email: "u@example.test",
        emailVerified: null,
      }),
    };

    const wrapped = withoutStoredCredentials(adapter);

    await expect(
      wrapped.getUserByAccount?.({
        provider: "github",
        providerAccountId: "12345678",
      }),
    ).resolves.toMatchObject({ id: "user-1" });
  });
});
