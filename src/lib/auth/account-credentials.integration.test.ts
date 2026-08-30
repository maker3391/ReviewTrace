import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter, AdapterAccount } from "next-auth/adapters";

import { db, type DbExecutor } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { withoutStoredCredentials } from "@/lib/auth/account-credentials";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **GitHub OAuth Credential 이 `accounts` 에 남지 않는다**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                       # 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있어야 한다
 * ```
 *
 * # 왜 Fake 로는 부족한가
 *
 * `account-credentials.test.ts` 는 **Adapter 에 무엇을 넘겼는가**까지만 본다. 그것과
 * 「행에 무엇이 남았는가」는 다른 질문이다 — Drizzle 이 `undefined` 를 어떻게 다루는지,
 * Column 기본값이 무엇인지는 실제 INSERT 를 해 봐야 안다. 여기서는 **진짜 Adapter로
 * 진짜 표에 INSERT 하고 그 행을 다시 조회한다.**
 *
 * 함께 확인하는 것은 로그인이 **여전히 되는가** 다 —
 * Credential 을 걷어낸 뒤에도 `getUserByAccount` 가 사용자를 찾고(재로그인),
 * 세션이 만들어지고 조회된다.
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 */

const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

class Rollback extends Error {}

async function inRollback(
  run: (tx: DbExecutor) => Promise<void>,
): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
}

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

/**
 * 시험 안의 Transaction 을 그대로 쓰는 Adapter.
 *
 * 제품 코드(`config.ts`)와 **같은 `DrizzleAdapter` 를 같은 표로** 만든다 — 다른 점은
 * 접속 대상이 `db()` 가 아니라 되돌려지는 `tx` 라는 것뿐이다.
 */
function adapterOn(tx: DbExecutor): Adapter {
  return withoutStoredCredentials(
    DrizzleAdapter(tx as Parameters<typeof DrizzleAdapter>[0], {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
  );
}

async function createUser(tx: DbExecutor): Promise<string> {
  const rows = await tx
    .insert(users)
    .values({ email: `${unique("acct")}@example.test`, name: "OAuth 시험" })
    .returning({ id: users.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  return id;
}

/** GitHub 콜백이 넘기는 모양. Token 값은 시험용 더미다. */
function githubAccount(userId: string, providerAccountId: string): AdapterAccount {
  return {
    userId,
    type: "oauth",
    provider: "github",
    providerAccountId,
    access_token: "gho_test_access_value",
    refresh_token: "ghr_test_refresh_value",
    expires_at: 1_900_000_000,
    token_type: "bearer",
    scope: "read:user,user:email",
  };
}

function findAccount(tx: DbExecutor, providerAccountId: string) {
  return tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.provider, "github"),
        eq(accounts.providerAccountId, providerAccountId),
      ),
    )
    .then((rows) => rows[0]);
}

describe.skipIf(!enabled)("GitHub OAuth Credential 저장 정책", () => {
  it("첫 로그인이 access_token 을 행에 남기지 않는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");

      await adapterOn(tx).linkAccount?.(
        githubAccount(userId, providerAccountId),
      );

      const row = await findAccount(tx, providerAccountId);

      expect(row).toBeDefined();
      expect(row?.access_token).toBeNull();
    });
  });

  it("첫 로그인이 refresh_token 을 행에 남기지 않는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");

      await adapterOn(tx).linkAccount?.(
        githubAccount(userId, providerAccountId),
      );

      expect((await findAccount(tx, providerAccountId))?.refresh_token).toBeNull();
    });
  });

  it("신원 칸은 그대로 남는다 — 없으면 재로그인이 사용자를 찾지 못한다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");

      await adapterOn(tx).linkAccount?.(
        githubAccount(userId, providerAccountId),
      );

      const row = await findAccount(tx, providerAccountId);

      expect(row?.provider).toBe("github");
      expect(row?.providerAccountId).toBe(providerAccountId);
      expect(row?.userId).toBe(userId);
      expect(row?.type).toBe("oauth");
      // Credential 이 아닌 이력 정보는 그대로 둔다.
      expect(row?.scope).toBe("read:user,user:email");
    });
  });

  it("Credential 을 걷어내도 재로그인이 같은 사용자를 찾는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");
      const adapter = adapterOn(tx);

      await adapter.linkAccount?.(githubAccount(userId, providerAccountId));

      // 재로그인이 도는 경로다 — Auth.js 는 이 결과가 있으면 세션만 만들고 돌아간다.
      const found = await adapter.getUserByAccount?.({
        provider: "github",
        providerAccountId,
      });

      expect(found?.id).toBe(userId);
    });
  });

  it("Credential 없이도 세션이 만들어지고 조회된다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");
      const adapter = adapterOn(tx);

      await adapter.linkAccount?.(githubAccount(userId, providerAccountId));

      const sessionToken = unique("sess");
      await adapter.createSession?.({
        sessionToken,
        userId,
        expires: new Date(Date.now() + 60_000),
      });

      const loaded = await adapter.getSessionAndUser?.(sessionToken);

      expect(loaded?.user.id).toBe(userId);
      expect(loaded?.session.userId).toBe(userId);
    });
  });

  it("Credential 을 담은 행이 이 표에 하나도 만들어지지 않는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");

      await adapterOn(tx).linkAccount?.(
        githubAccount(userId, providerAccountId),
      );

      // 이번 Transaction 이 만든 것 중 Credential 이 남은 행이 있는지 전수로 본다.
      const leaked = await tx
        .select({ providerAccountId: accounts.providerAccountId })
        .from(accounts)
        .where(eq(accounts.userId, userId));

      expect(leaked).toHaveLength(1);

      const row = await findAccount(tx, providerAccountId);
      expect(row?.access_token).toBeNull();
      expect(row?.refresh_token).toBeNull();
      expect(row?.id_token).toBeNull();
    });
  });
});

/**
 * 🔴 **코드 수정만으로는 «이미 저장된» Credential 이 사라지지 않는다.**
 *
 * `withoutStoredCredentials` 는 앞으로의 `linkAccount` 입력에만 걸린다. 재로그인은 OAuth
 * 계정 행이 이미 있으면 `linkAccount` 를 다시 부르지 않으므로(위 시험이 그 경로를 본다),
 * 그 코드가 나가기 «전»에 로그인한 사람의 평문 Token 은 표에 **영원히 남는다.**
 * 안 가지고 있는 것은 샐 수 없다 — 남아 있는 것을 지우는 것이 Migration 의 몫이다.
 *
 * # 🔴 Migration SQL 을 시험에 옮겨 적지 않는다
 *
 * 옮겨 적으면 **시험은 자기가 적은 문장을 확인할 뿐**이고, 정작 적용될 파일이 잘못돼 있어도
 * 초록이다. 파일에서 읽어 그대로 실행한다.
 */
describe.skipIf(!enabled)("이미 저장된 OAuth Credential 정리 Migration", () => {
  const MIGRATION = "0008_strip_stored_oauth_credentials.sql";

  function migrationSql(): string {
    return readFileSync(
      join(process.cwd(), "src/db/migrations", MIGRATION),
      "utf8",
    );
  }

  it("🔴 남아 있던 access_token·refresh_token 을 비운다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");

      // 🔴 걷어내는 Adapter 를 «지나지 않고» 넣는다 — 옛 코드가 남긴 행의 재현이다.
      await tx.insert(accounts).values({
        userId,
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: "gho_legacy_access_value",
        refresh_token: "ghr_legacy_refresh_value",
        expires_at: 1_900_000_000,
        token_type: "bearer",
        scope: "read:user,user:email",
      });

      const before = await findAccount(tx, providerAccountId);
      expect(before?.access_token).toBe("gho_legacy_access_value");
      expect(before?.refresh_token).toBe("ghr_legacy_refresh_value");

      await tx.execute(sql.raw(migrationSql()));

      const after = await findAccount(tx, providerAccountId);
      expect(after?.access_token).toBeNull();
      expect(after?.refresh_token).toBeNull();
    });
  });

  /**
   * 🔴 **신원 칸을 건드리면 재로그인이 사용자를 찾지 못한다**(`getUserByAccount`).
   * 이력 칸(`scope`·`token_type`·`expires_at`)은 Credential 이 아니므로 그대로 둔다.
   */
  it("🔴 신원 칸과 이력 칸은 그대로 남는다 — 행도 지우지 않는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("gh");

      await tx.insert(accounts).values({
        userId,
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: "gho_legacy_access_value",
        expires_at: 1_900_000_000,
        token_type: "bearer",
        scope: "read:user,user:email",
      });

      await tx.execute(sql.raw(migrationSql()));

      const row = await findAccount(tx, providerAccountId);
      expect(row).toBeDefined();
      expect(row?.provider).toBe("github");
      expect(row?.providerAccountId).toBe(providerAccountId);
      expect(row?.userId).toBe(userId);
      expect(row?.type).toBe("oauth");
      expect(row?.scope).toBe("read:user,user:email");
      expect(row?.token_type).toBe("bearer");
      expect(row?.expires_at).toBe(1_900_000_000);

      // 재로그인 경로가 여전히 이 사용자를 찾는다.
      const found = await adapterOn(tx).getUserByAccount?.({
        provider: "github",
        providerAccountId,
      });
      expect(found?.id).toBe(userId);
    });
  });

  /**
   * 🔴 **provider 를 좁히지 않는다.** 걷어내는 코드(`CREDENTIAL_FIELDS`)가 provider 를 보지
   * 않고 모든 `linkAccount` 에 걸리므로, Migration 만 GitHub 으로 좁히면 두 자리의 범위가
   * 갈린다 — 다른 provider 가 붙는 순간 그쪽 Credential 만 조용히 남는다.
   */
  it("🔴 GitHub 이 아닌 provider 의 Credential 도 함께 비운다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx);
      const providerAccountId = unique("other");

      await tx.insert(accounts).values({
        userId,
        type: "oauth",
        provider: "some-other-provider",
        providerAccountId,
        access_token: "other_access_value",
        refresh_token: "other_refresh_value",
      });

      await tx.execute(sql.raw(migrationSql()));

      const rows = await tx
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.provider, "some-other-provider"),
            eq(accounts.providerAccountId, providerAccountId),
          ),
        );

      expect(rows[0]?.access_token).toBeNull();
      expect(rows[0]?.refresh_token).toBeNull();
      // 신원은 그대로다.
      expect(rows[0]?.provider).toBe("some-other-provider");
    });
  });
});
