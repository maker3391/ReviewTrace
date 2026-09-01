import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  createInvitation,
  revokeInvitation,
} from "@/features/invitations/server/invitation-service";
import { hashInvitationToken } from "@/features/invitations/server/invitation-token";
import { isAppError } from "@/lib/errors";

/**
 * 실제 PostgreSQL 로 보는 **「살아 있는 초대는 (Workspace, Email) 당 하나」**.
 *
 * # 🔴 이 시험은 Migration 적용 «전후» 양쪽에서 돈다
 *
 * `0006` Migration 을 적용하기 전에 쓰였다. 그때는 시험이 자기 Transaction 안에서
 * 그 Migration 을 직접 실행해 index 를 만들었다. 🔴 **적용한 뒤에는 그 문장이
 * `42P07 relation … already exists` 로 터진다** — 실제로 그렇게 8건이 한꺼번에
 * 빨개졌고, 원인은 제품이 아니라 「아직 적용 안 됨」을 전제한 이 시험이었다.
 *
 * 그래서 **있으면 쓰고 없으면 만든다**로 바꿨다. 둘 다 지켜야 하기 때문이다:
 *
 * ```
 * 적용 전 BEGIN -> Migration SQL 실행 -> 확인 -> ROLLBACK (index 도 데이터도 안 남는다)
 * 적용 후 BEGIN -> 이미 있음 -> 확인 -> ROLLBACK (데이터만 안 남는다)
 * ```
 *
 * 🔴 **적용 여부를 시험이 «판단해서 건너뛰지» 않는다.** 어느 쪽이든 invariant 자체는
 * 똑같이 검사한다 — 건너뛰면 그날부터 아무도 이 규칙을 지키지 않는다.
 *
 * `0007_invitation_revoke` 가 predicate 를 **`accepted_at IS NULL AND revoked_at IS NULL`**
 * 로 넓혔다. 그래서 「있으면 쓴다」가 아니라 **「서 있는 정의가 맞는지 읽어 보고 낡았으면
 * 다시 세운다」**로 한 겹 더 갔다 — 옛 index 로 취소 invariant 를 확인하면 거짓 초록이다.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test # 통째로 건너뛴다
 * DB_INTEGRATION=true pnpm test # PostgreSQL 이 떠 있어야 한다
 * ```
 *
 * 기본 실행에서 도는 짝은 `invitation-service.test.ts` 다 — 그쪽은 **판정 규칙**과
 * **보낸 문장의 모양**만 본다. 🔴 Fake 는 `where` 를 해석하지 않고 제약도 없으므로,
 * **중복이 실제로 막히는가**는 오직 이 파일만 답할 수 있다.
 *
 * 🔴 **데이터를 남기지 않는다.** 있는 데이터를 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

const INDEX_NAME = "workspace_invitations_live_email_unique";

/**
 * Migration 파일에서 이 index 를 **마지막으로** 만드는 문장을 그대로 꺼내 온다.
 *
 * 🔴 시험에 SQL 을 손으로 옮겨 적지 않는다. 옮겨 적으면 **시험은 자기가 적은 index 를 확인할
 * 뿐**이고, 정작 적용될 Migration 이 잘못돼 있어도 초록이다.
 * 🔴 **`db:generate` 가 만들어 낸 SQL 을 그대로 믿지 않는다** — 실제로 `0002` 는 Column 이
 * 만들어지기 «전»에 그것으로 PK 를 걸어 적용에 실패한 적이 있다.
 *
 * 🔴 **「문장이 하나뿐이어야 한다」로 적지 않는다.** predicate 가 바뀌면 Migration 은
 * `DROP` + `CREATE` 로 나오고(`0007_invitation_revoke`), 그 순간 개수를 세던 방식은
 * 제품이 아니라 **시험이 먼저 터진다.** 파일 이름 순서가 곧 적용 순서이므로 **마지막
 * `CREATE`** 가 지금 서 있어야 할 정의다.
 */
function liveEmailIndexMigration(): string {
  const directory = join(process.cwd(), "src/db/migrations");
  const creates = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8").split(
        "--> statement-breakpoint",
      ),
    )
    .map((statement) => statement.trim().replace(/;$/, ""))
    .filter(
      (statement) =>
        statement.includes(INDEX_NAME) &&
        /create\s+unique\s+index/i.test(statement),
    );

  const latest = creates.at(-1);
  if (latest === undefined) {
    throw new Error("Migration 에서 index 생성 문장을 찾지 못했다");
  }
  return latest;
}

class Rollback extends Error {}

/**
 * 되돌려지는 Transaction 안에서 돌린다.
 *
 * 🔴 **이미 서 있는 정의가 맞으면 그것을 그대로 쓴다.** 적용된 Database 에서 다시 만들면
 * `42P07` 로 터지고, 그것은 규칙이 깨진 것이 아니라 시험이 환경을 잘못 가정한 것이다 —
 * 실제로 그렇게 8건이 한꺼번에 빨개진 적이 있다.
 *
 * 🔴 **없을 때뿐 아니라 «낡았을» 때도 만든다.** `0007` 이 predicate 에 `revoked_at` 을
 * 더했는데, 「있으면 쓴다」만 보면 옛 정의(`accepted_at IS NULL`)가 서 있는 Database 에서
 * 취소 관련 invariant 를 **옛 index 로 확인해** 거짓 초록이 된다. 정의를 실제로 읽어
 * 대조하고, 다르면 Migration 파일의 문장으로 다시 세운다(Transaction 안이라 되돌아간다).
 */
async function withLiveEmailIndex(
  run: (tx: DbExecutor) => Promise<void>,
): Promise<void> {
  const expected = liveEmailIndexMigration();
  // predicate 에 무엇이 들어가야 하는지도 **Migration 문장에서** 읽는다. 손으로 적지 않는다.
  const needsRevokedAt = expected.includes("revoked_at");

  try {
    await db().transaction(async (tx) => {
      const existing = await tx.execute<{ indexdef: string }>(
        sql`select indexdef from pg_indexes where indexname = ${INDEX_NAME}`,
      );
      const definition = existing.rows[0]?.indexdef;
      const stale =
        definition === undefined ||
        (needsRevokedAt && !definition.includes("revoked_at"));

      if (stale) {
        await tx.execute(sql.raw(`drop index if exists "${INDEX_NAME}"`));
        await tx.execute(sql.raw(expected));
      }
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

async function createOwner(tx: DbExecutor): Promise<string> {
  const rows = await tx
    .insert(users)
    .values({ email: `${unique("owner")}@example.test`, name: "Owner" })
    .returning({ id: users.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  return id;
}

async function createWorkspace(
  tx: DbExecutor,
  ownerId: string,
): Promise<string> {
  const rows = await tx
    .insert(workspaces)
    .values({ slug: unique("inv-"), name: "Invariant", createdBy: ownerId })
    .returning({ id: workspaces.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 Workspace 를 만들지 못했다");
  }
  return id;
}

async function liveRows(
  tx: DbExecutor,
  workspaceId: string,
  email: string,
): Promise<
  {
    id: string;
    tokenHash: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  }[]
> {
  return tx
    .select({
      id: workspaceInvitations.id,
      tokenHash: workspaceInvitations.tokenHash,
      expiresAt: workspaceInvitations.expiresAt,
      acceptedAt: workspaceInvitations.acceptedAt,
      revokedAt: workspaceInvitations.revokedAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
      ),
    );
}

/**
 * Driver 의 SQLSTATE 를 꺼낸다. Drizzle 이 원인을 `cause` 로 감싸는 경우가 있어 한 겹 더 본다.
 */
function sqlState(error: unknown): string | undefined {
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current !== null && current !== undefined;
    depth += 1
  ) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

const GUEST = "guest@example.test";

describe.skipIf(!enabled)(
  "살아 있는 초대는 (Workspace, Email) 당 하나다",
  () => {
    it("Migration 이 만드는 것은 «부분» unique index 다 — 수락된 행은 그 밖이다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const rows = await tx.execute<{ indexdef: string }>(
          sql`select indexdef from pg_indexes
 where tablename = 'workspace_invitations'
 and indexname = 'workspace_invitations_live_email_unique'`,
        );

        const definition = rows.rows[0]?.indexdef ?? "";
        expect(definition).toContain("UNIQUE INDEX");
        expect(definition).toContain("(workspace_id, email)");
        /*
 🔴 **「살아 있다」는 둘 다 비어 있는 것이다.** 수락된 행은 History 라 막으면 나갔던
 사람을 다시 초대할 수 없고, **취소된 행도 마찬가지다** — 새어 나간 링크를 죽이는 일이
 그 주소를 영영 초대하지 못하게 만드는 일이 되어서는 안 된다.
 */
        expect(definition).toContain(
          "WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL))",
        );
        // 🔴 시간이 흐르면 저절로 뜻이 바뀌는 조건은 제약이 아니다 — predicate 에 넣지 않았다.
        expect(definition).not.toContain("expires_at");
      });
    });

    /**
     * 🔴 **Migration 이 아직 적용되지 않은 Database 에서도 초대 발행이 «멈추지 않는다».**
     *
     * 운영 Database 가 지금 정확히 그 상태다. 처음에는 `on conflict (workspace_id, email)` 로
     * 대상을 적어 두었는데, PostgreSQL 이 중재할 index 를 계획 단계에서 찾지 못해
     * **`42P10` 으로 문장이 통째로 터졌다** — 기존 통합시험 4건이 실제로 그렇게 빨간불이 됐다.
     * 그래서 대상 없는 `on conflict do nothing` 으로 바꿨다. 이 시험은 그 회귀를 붙든다.
     *
     * 🔴 index 가 없는 동안은 **중복이 막히지 않는다.** 그것이 Migration 을 적용해야 하는 이유다.
     */
    it("🔴 index 가 아직 없어도 초대 발행이 터지지 않는다 (Migration 이 코드보다 늦게 적용되는 구간)", async () => {
      try {
        await db().transaction(async (tx) => {
          const owner = await createOwner(tx);
          const workspace = await createWorkspace(tx, owner);

          await createInvitation(
            { workspaceId: workspace, email: GUEST, invitedBy: owner },
            tx,
          );
          expect(await liveRows(tx, workspace, GUEST)).toHaveLength(1);

          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) {
          throw error;
        }
      }
    });

    it("첫 초대는 발행된다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        const invitation = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        const rows = await liveRows(tx, workspace, GUEST);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.tokenHash).toBe(hashInvitationToken(invitation.token));
      });
    });

    it("🔴 살아 있는 초대가 있으면 두 번째는 CONFLICT 이고 행이 늘지 않는다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        const first = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );
        const error = await rejection(
          createInvitation(
            { workspaceId: workspace, email: GUEST, invitedBy: owner },
            tx,
          ),
        );

        expect(isAppError(error) && error.code).toBe("CONFLICT");

        const rows = await liveRows(tx, workspace, GUEST);
        expect(rows).toHaveLength(1);
        // 🔴 먼저 보낸 링크를 «빼앗지» 않는다 — 실패한 요청이 남의 초대를 덮어쓰면 안 된다.
        expect(rows[0]?.tokenHash).toBe(hashInvitationToken(first.token));
      });
    });

    /**
     * 🔴 정규화가 저장 «전»에 끝나므로 index 가 대소문자·공백 차이를 그대로 붙든다.
     * 비교 시점에 `lower()` 를 씌우는 방식이었다면 이 시험이 통과하지 못한다
     * (`src/lib/validation/email.ts`).
     */
    it("🔴 대소문자·공백만 다른 주소도 같은 초대로 막힌다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        for (const variant of [" Guest@Example.TEST ", "GUEST@EXAMPLE.TEST"]) {
          const error = await rejection(
            createInvitation(
              { workspaceId: workspace, email: variant, invitedBy: owner },
              tx,
            ),
          );
          expect(isAppError(error) && error.code).toBe("CONFLICT");
        }

        expect(await liveRows(tx, workspace, GUEST)).toHaveLength(1);
      });
    });

    it("다른 Workspace 는 같은 주소를 초대할 수 있다 — 경계는 Tenant 안이다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const acme = await createWorkspace(tx, owner);
        const other = await createWorkspace(tx, owner);

        await createInvitation(
          { workspaceId: acme, email: GUEST, invitedBy: owner },
          tx,
        );
        await createInvitation(
          { workspaceId: other, email: GUEST, invitedBy: owner },
          tx,
        );

        expect(await liveRows(tx, acme, GUEST)).toHaveLength(1);
        expect(await liveRows(tx, other, GUEST)).toHaveLength(1);
      });
    });

    /**
     * 🔴 만료돼도 `accepted_at` 은 `NULL` 이라 그 행은 index 안에 남는다. 회전시키지 않으면
     * **그 주소를 영영 다시 초대할 수 없다.**
     */
    it("🔴 만료된 초대는 «회전»한다 — 행이 늘지 않고 Token 과 기한이 새것이 된다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        const first = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        await tx
          .update(workspaceInvitations)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(workspaceInvitations.workspaceId, workspace));

        const second = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        const rows = await liveRows(tx, workspace, GUEST);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.tokenHash).toBe(hashInvitationToken(second.token));
        expect(rows[0]?.tokenHash).not.toBe(hashInvitationToken(first.token));
        expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });

    /**
     * 수락된 행은 index predicate 밖이라 History 로 남고, 그 위에 새 초대가 따로 선다.
     * (지금 제품에서는 「이미 멤버」 확인이 이 경로를 먼저 막는다 — 여기서 보는 것은
     * **index 가 History 를 막지 않는다**는 것뿐이다.)
     */
    it("수락된 초대는 History 로 남고 그 위에 새 초대가 설 수 있다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );
        await tx
          .update(workspaceInvitations)
          .set({ acceptedAt: new Date() })
          .where(eq(workspaceInvitations.workspaceId, workspace));

        await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        const rows = await liveRows(tx, workspace, GUEST);
        expect(rows).toHaveLength(2);
        expect(rows.filter((row) => row.acceptedAt === null)).toHaveLength(1);
      });
    });

    /**
     * # 🔴 취소가 재초대를 막으면 안 된다
     *
     * `revoked_at` 을 더하면서 predicate 를 그대로 두면(= `accepted_at IS NULL` 만),
     * 취소된 행이 index 안에 남아 **그 주소를 다시 초대할 수 없다.** 그러면 「새어 나간 링크를
     * 죽인다」가 「이 사람을 영구 차단한다」가 되어 버린다 — 취소 기능을 넣지 않느니만 못하다.
     *
     * 🔴 **되돌림 확인이 시험 안에 있다.** 같은 재초대를 **옛 predicate** 로 다시 세운
     * index 아래에서 시도해 **막히는 것**까지 본다. 그러지 않으면 이 시험은
     * 「원래 되는 것 아닌가」와 구분되지 않는다.
     */
    it("🔴 취소된 초대는 재초대를 막지 않는다 (옛 predicate 로 되돌리면 막힌다)", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        const first = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );
        await revokeInvitation(
          {
            workspaceId: workspace,
            invitationId: (await liveRows(tx, workspace, GUEST))[0]
              ?.id as string,
          },
          tx,
        );

        const second = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        const rows = await liveRows(tx, workspace, GUEST);
        // 🔴 **회전이 아니라 «새 행»이다.** 취소 기록이 덮어써지지 않는다.
        expect(rows).toHaveLength(2);
        expect(rows.filter((row) => row.revokedAt !== null)).toHaveLength(1);
        expect(rows.find((row) => row.revokedAt === null)?.tokenHash).toBe(
          hashInvitationToken(second.token),
        );
        expect(rows.find((row) => row.revokedAt !== null)?.tokenHash).toBe(
          hashInvitationToken(first.token),
        );

        /*
 🔴 되돌림: predicate 에서 `revoked_at` 을 빼면 **같은 재초대가 막힌다.**
 (여기서는 이미 두 행이 있으므로 옛 predicate 로는 index 를 세우는 것 자체가
 `23505` 다 — 그것이 곧 「옛 predicate 였다면 이 상태에 이르지 못했다」는 증거다.)
 */
        await tx.execute(sql.raw(`drop index "${INDEX_NAME}"`));
        const stale = await rejection(
          tx.execute(
            sql.raw(
              `create unique index "${INDEX_NAME}" on "workspace_invitations" ` +
                `("workspace_id","email") where "accepted_at" is null`,
            ),
          ),
        );
        expect(sqlState(stale)).toBe("23505");
      });
    });

    /**
     * 🔴 **취소된 행은 «회전»하지 않는다.** 만료는 시간이 지나 저절로 된 것이라 같은 행을
     * 되살려도 잃는 것이 없지만, 취소는 사람이 죽인 것이다 — 되살아나면 취소가 없던 일이 되고
     * 취소 기록도 함께 지워진다.
     *
     * 회전 UPDATE 에서 `revoked_at IS NULL` 을 빼면 「만료 + 취소」된 행까지 함께 잡혀
     * **한 UPDATE 가 두 행에 같은 `token_hash` 를 쓴다** — `token_hash` unique 가 터진다.
     */
    it("🔴 «만료 + 취소»된 행은 회전 대상이 아니다 — 살아 있는 만료 행만 회전한다", async () => {
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        // 1) 초대 -> 취소 (index 밖으로 나간다)
        await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );
        const revokedId = (await liveRows(tx, workspace, GUEST))[0]
          ?.id as string;
        await revokeInvitation(
          { workspaceId: workspace, invitationId: revokedId },
          tx,
        );

        // 2) 재초대 -> 그 행이 만료된다. 이제 표에는 「만료+취소」와 「만료+살아있음」이 있다.
        const second = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );
        await tx
          .update(workspaceInvitations)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(workspaceInvitations.workspaceId, workspace));

        // 3) 다시 초대 -> 살아 있는 만료 행 «하나»만 회전한다.
        const third = await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        const rows = await liveRows(tx, workspace, GUEST);
        expect(rows).toHaveLength(2);

        const revoked = rows.find((row) => row.id === revokedId);
        const live = rows.find((row) => row.id !== revokedId);

        // 취소된 행은 손대지 않았다 — Token 도 기한도 그대로다.
        expect(revoked?.revokedAt).not.toBeNull();
        expect(revoked?.tokenHash).not.toBe(hashInvitationToken(third.token));
        expect(revoked?.expiresAt.getTime()).toBeLessThan(Date.now());

        // 살아 있던 만료 행만 새 Token·새 기한을 얻었다.
        expect(live?.tokenHash).toBe(hashInvitationToken(third.token));
        expect(live?.tokenHash).not.toBe(hashInvitationToken(second.token));
        expect(live?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });

    /**
     * # 🔴 여기가 이 작업의 핵심이다
     *
     * 응용 코드를 **통째로 건너뛴** INSERT 를 Database 가 거절한다. 「초대 전에 조회해 본다」로
     * 막는 것이었다면 이 INSERT 는 그대로 들어간다 — 동시 요청 둘이 조회 단계를 함께 통과하는
     * 상황이 정확히 이 모양이다.
     *
     * 🔴 **되돌림 확인이 시험 안에 있다.** 같은 INSERT 를 index 를 지운 뒤에 다시 시도해
     * **통과하는 것**까지 본다 — 그러지 않으면 「그 INSERT 는 원래 실패하는 것 아닌가」와
     * 구분되지 않아 시험이 무엇도 증명하지 못한다.
     */
    it("🔴 응용 코드를 건너뛴 INSERT 를 «Database 가» 거절한다 (index 를 지우면 통과한다)", async () => {
      // 아래 INSERT 는 `on conflict do nothing` 없이 날것으로 던진다 — 제품 코드가 아니라
      // Database 가 막는다는 것을 보이기 위해서다.
      await withLiveEmailIndex(async (tx) => {
        const owner = await createOwner(tx);
        const workspace = await createWorkspace(tx, owner);

        await createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        );

        const rawInsert = () =>
          tx.insert(workspaceInvitations).values({
            workspaceId: workspace,
            email: GUEST,
            role: "MEMBER",
            tokenHash: unique("hash-"),
            expiresAt: new Date(Date.now() + 60_000),
            invitedBy: owner,
          });

        await tx.execute(sql`savepoint blocked`);
        const blocked = await rejection(rawInsert());
        expect(sqlState(blocked)).toBe("23505");
        await tx.execute(sql`rollback to savepoint blocked`);

        // 🔴 되돌림: index 가 없으면 **같은 INSERT 가 통과한다.**
        await tx.execute(
          sql`drop index "workspace_invitations_live_email_unique"`,
        );
        await rawInsert();
        expect(await liveRows(tx, workspace, GUEST)).toHaveLength(2);
      });
    });
  },
);

/**
 * 실제 PostgreSQL 로 보는 **「이미 멤버인 사람에게는 초대가 서지 않는다」**.
 *
 * # 🔴 왜 «따로 조회해서» 확인하면 안 되는가
 *
 * 확인이 `SELECT` 한 문장, 발행이 그 다음 `INSERT` 로 나뉘어 있었다. PostgreSQL 의 기본
 * 격리 수준(READ COMMITTED)에서 SELECT 는 **그 문장이 시작한 시점의 스냅샷**을 보므로,
 * 그 사이 다른 Transaction 이 소속을 만들고 commit 해도 이쪽은 보지 못한다. 그러면 옛
 * 초대 행이 부분 index 밖으로 빠져 INSERT 가 성공하고, **이미 멤버인 사람 앞으로 살아
 * 있는 링크가 하나 더 선다.** 수락할 때 이메일을 맞대더라도 이미 멤버인 주소 앞으로
 * 쓸 수 없는 bearer credential 을 다시 내는 것은 잘못이다.
 *
 * 🔴 **동시 실행 두 개를 실제로 부딪혀 보지는 않았다.** 되돌려지는 Transaction 하나
 * 안에서는 두 번째 연결이 이쪽 행을 볼 수 없어 그 경쟁을 재현할 수 없다. 여기서 붙드는
 * 것은 **판정이 쓰는 문장 자체에 실려 있고 실제 Database 가 그것을 그대로 지킨다**는
 * 사실이다 — 그 조건이 문장 안에 있으면 스냅샷 문제 자체가 성립하지 않는다.
 */
describe.skipIf(!enabled)("이미 멤버인 주소에는 초대가 서지 않는다", () => {
  /** 그 Workspace 의 멤버 한 사람. 이메일이 초대 대상과 같은 주소다. */
  async function joinAsMember(
    tx: DbExecutor,
    workspaceId: string,
    email: string,
  ): Promise<void> {
    const rows = await tx
      .insert(users)
      .values({ email, name: "Guest" })
      .returning({ id: users.id });

    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error("시험용 멤버를 만들지 못했다");
    }

    await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: "MEMBER" });
  }

  it("🔴 이미 멤버면 CONFLICT 이고 초대 행이 «하나도» 생기지 않는다", async () => {
    await withLiveEmailIndex(async (tx) => {
      const owner = await createOwner(tx);
      const workspace = await createWorkspace(tx, owner);
      await joinAsMember(tx, workspace, GUEST);

      const error = await rejection(
        createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        ),
      );

      expect(isAppError(error) && error.code).toBe("CONFLICT");
      // 🔴 Token 을 내주지 않았을 뿐 아니라 행 자체가 없다.
      expect(await liveRows(tx, workspace, GUEST)).toHaveLength(0);
    });
  });

  /**
   * 🔴 **대소문자·공백만 다른 주소로 이미 멤버인 사람을 다시 초대할 수 없다.**
   *
   * `users.email` 은 저장 시점에 이미 정규 형태다(`lib/auth/github-profile.ts`).
   * 비교하는 값을 정규화하지 않으면 이 조건이 어느 행도 잡지 못해 **이미 멤버인 사람에게
   * 초대가 다시 발행된다** — 실제로 그렇게 깨져 있던 자리다.
   */
  it("🔴 대소문자·공백만 다른 주소로도 이미 멤버인 사람을 다시 초대할 수 없다", async () => {
    await withLiveEmailIndex(async (tx) => {
      const owner = await createOwner(tx);
      const workspace = await createWorkspace(tx, owner);
      await joinAsMember(tx, workspace, GUEST);

      const error = await rejection(
        createInvitation(
          {
            workspaceId: workspace,
            email: " Guest@Example.TEST ",
            invitedBy: owner,
          },
          tx,
        ),
      );

      expect(isAppError(error) && error.code).toBe("CONFLICT");
      expect(await liveRows(tx, workspace, GUEST)).toHaveLength(0);
    });
  });

  /**
   * 🔴 **회전에도 같은 조건이 붙어야 한다.**
   *
   * 만료된 초대가 남아 있는 사이에 그 사람이 다른 경로로 멤버가 됐다면, 회전은
   * **이미 멤버인 사람에게 새 Token 을 발행하는 일**이 된다 — INSERT 만 막아 두면
   * 그 뒷문이 그대로 열려 있다. 실제로 옛 Token 이 그대로 남는지까지 본다.
   */
  it("🔴 만료된 초대가 있어도 이미 멤버면 회전하지 않는다 — 옛 Token 이 그대로다", async () => {
    await withLiveEmailIndex(async (tx) => {
      const owner = await createOwner(tx);
      const workspace = await createWorkspace(tx, owner);

      const first = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );

      // 기한을 과거로 밀어 「만료된 살아 있는 초대」를 만든다.
      const expired = new Date(Date.now() - 60_000);
      await tx
        .update(workspaceInvitations)
        .set({ expiresAt: expired })
        .where(eq(workspaceInvitations.workspaceId, workspace));

      // 그 사이 그 사람이 멤버가 됐다.
      await joinAsMember(tx, workspace, GUEST);

      const error = await rejection(
        createInvitation(
          { workspaceId: workspace, email: GUEST, invitedBy: owner },
          tx,
        ),
      );

      expect(isAppError(error) && error.code).toBe("CONFLICT");

      const rows = await liveRows(tx, workspace, GUEST);
      expect(rows).toHaveLength(1);
      // 🔴 회전하지 않았다 — Token 도 기한도 옛것 그대로다.
      expect(rows[0]?.tokenHash).toBe(hashInvitationToken(first.token));
      expect(rows[0]?.expiresAt.getTime()).toBe(expired.getTime());
    });
  });

  /** 멤버가 아니면 그대로 발행된다 — 조건이 «아무도 막지 않는» 것이 아님을 함께 붙든다. */
  it("멤버가 아닌 주소에는 그대로 발행된다", async () => {
    await withLiveEmailIndex(async (tx) => {
      const owner = await createOwner(tx);
      const workspace = await createWorkspace(tx, owner);
      // 같은 주소의 사용자가 «다른» Workspace 의 멤버인 것은 아무것도 막지 않는다.
      const otherWorkspace = await createWorkspace(tx, owner);
      await joinAsMember(tx, otherWorkspace, GUEST);

      const invitation = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );

      const rows = await liveRows(tx, workspace, GUEST);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(hashInvitationToken(invitation.token));
    });
  });

  /**
   * 🔴 직접 적은 SQL 이 **표의 Column 을 옳게 채우는가.**
   *
   * `values(...)` 를 버리고 `insert... select` 로 바꿨으므로 Column 순서를 손으로 적었다.
   * 한 칸이라도 어긋나면 엉뚱한 Column 에 값이 들어가는데, 타입이 우연히 맞으면
   * **Database 도 조용히 받아 준다.** 저장된 행을 그대로 읽어 대조한다.
   */
  it("🔴 직접 적은 INSERT 가 모든 Column 을 제자리에 넣는다", async () => {
    await withLiveEmailIndex(async (tx) => {
      const owner = await createOwner(tx);
      const workspace = await createWorkspace(tx, owner);

      const invitation = await createInvitation(
        {
          workspaceId: workspace,
          email: " Guest@Example.TEST ",
          invitedBy: owner,
        },
        tx,
      );

      const rows = await tx
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspace));

      const row = rows[0];
      expect(rows).toHaveLength(1);
      expect(row?.email).toBe("guest@example.test");
      expect(row?.role).toBe("MEMBER");
      expect(row?.tokenHash).toBe(hashInvitationToken(invitation.token));
      expect(row?.expiresAt.getTime()).toBe(invitation.expiresAt.getTime());
      expect(row?.invitedBy).toBe(owner);
      // 기본값이 붙는 칸은 Database 가 채운다.
      expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row?.createdAt).toBeInstanceOf(Date);
      // 새 초대는 소진되지도 취소되지도 않았다.
      expect(row?.acceptedAt).toBeNull();
      expect(row?.revokedAt).toBeNull();
      expect(row?.acceptedBy).toBeNull();
    });
  });
});
