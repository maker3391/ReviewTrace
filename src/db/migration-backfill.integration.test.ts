import { readFileSync } from "node:fs";

import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * `0015`·`0016` 의 **backfill SQL 자체**를 실제 PostgreSQL 에서 돌린다.
 *
 * ```bash
 * DB_INTEGRATION=true pnpm test
 * ```
 *
 * # 🔴 CI 가 이미 보장하는 것과, 보장하지 «못»하는 것
 *
 * CI 는 `postgres:17-alpine` 을 새로 띄우고 `pnpm db:migrate` 로 `0000`→최신을 적용한 뒤
 * 통합시험을 돌린다(`.github/workflows/ci.yml`). 그래서 **문법·적용 순서·index 생성**은
 * 이미 매번 확인된다.
 *
 * 🔴 **비어 있는 Database 라는 것이 한계다.** backfill 은 「이미 쌓여 있는 행」을 고치는
 * 문장인데, 갓 만든 Database 에는 고칠 행이 없다 — 문장이 **0행에 대해 성공**하고 끝난다.
 * 그래서 다음 다섯 가지가 CI 밖에 남아 있었다.
 *
 * ```
 * 이미 순번이 있는 행   ·  비어 있는 행   ·  아주 큰 순번
 * 배포 창에 끼어든 행   ·  unique 제약과 재배열이 부딪히는 자리
 * ```
 *
 * # 🔴 파일을 «그대로» 읽어 돌린다
 *
 * SQL 을 시험에 옮겨 적으면 그것은 **복사본을 시험하는 것**이라 원본이 바뀌어도 초록이다.
 * 여기서는 `src/db/migrations/*.sql` 을 읽어 `--> statement-breakpoint` 로 갈라 실행한다.
 *
 * 🔴 **`ALTER TABLE` 과 `CREATE INDEX` 는 다시 돌릴 수 없다**(이미 있다). `0015` 에서는
 * 데이터 문장인 `UPDATE` 만 고르고, `0016` 은 세 문장이 모두 재실행 가능하라 전부 돌린다.
 *
 * # 🔴 이 시험이 «고정하지 못하는» 것
 *
 * 여기서 도는 것은 한 Transaction 안의 **데이터 변환**뿐이다. `0016` 의 첫 문장
 * (`SELECT … FOR UPDATE … ORDER BY id`)을 통째로 지워도 **모든 시험이 그대로 통과한다** —
 * 최종 데이터만 보기 때문이다. 잠금 계약을 재려면 commit 된 fixture 와 연결 여럿이 필요하고,
 * 그것은 `features/issues/server/issue-activity-ordinal.integration.test.ts` 가 애플리케이션
 * 경로에 대해 하는 일이다. 🔴 **migration 문장의 잠금은 어느 시험도 지키지 않는다.**
 *
 * # 🔴 데이터를 남기지 않는다 — 다만 범위는 «조건부»다
 *
 * 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다. migration 문장은 표 **전체**를
 * 훑되 `ordinal IS NULL` 인 행을 가진 Issue 로 좁혀지는데, **그런 행이 이 Transaction 이 만든
 * 것뿐이라는 보장은 없다** — 갓 만든 CI Database 에서는 참이지만, 재사용하는 Database 에
 * 그런 행이 남아 있으면 그것까지 대상이 된다. 되돌아가는 Transaction 이라 **밖에 남는 변화는
 * 없지만**, 단언이 다른 행에 흔들릴 수는 있다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

/** 시험 하나를 되돌리기 위한 표식. 실제 실패와 구분하려고 전용 타입을 쓴다. */
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

/** 실제 migration 파일의 문장들. 주석만 남는 조각은 버린다. */
function statementsOf(fileName: string): string[] {
  return readFileSync(`src/db/migrations/${fileName}`, "utf8")
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => {
      const code = chunk
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      return code.length > 0;
    });
}

/** `0015` 의 데이터 문장. `ALTER TABLE`·`CREATE INDEX` 는 이미 적용돼 다시 돌릴 수 없다. */
function backfillOf0015(): string {
  const found = statementsOf("0015_curly_exiles.sql").filter((statement) =>
    /^\s*(--.*\n|\s)*UPDATE\b/i.test(statement),
  );
  if (found.length !== 1) {
    throw new Error(
      `0015 의 UPDATE 문장을 하나 찾지 못했다 (${String(found.length)}개)`,
    );
  }
  return found[0] ?? "";
}

async function runAll(tx: DbExecutor, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await tx.execute(sql.raw(statement));
  }
}

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `mig-${prefix}${Date.now().toString(36)}${seq}`;
}

interface Fixture {
  workspaceId: string;
  reviewSessionId: string;
  repositoryId: string;
}

async function seed(tx: DbExecutor): Promise<Fixture> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "mig" })
    .returning({ id: users.id });
  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: "mig", slugSource: unique("ws-") },
    tx,
  );

  const projectRows = await tx
    .insert(projects)
    .values({ workspaceId, name: "mig", slug: unique("p-") })
    .returning({ id: projects.id });
  const projectId = projectRows[0]?.id;
  if (projectId === undefined) {
    throw new Error("시험용 Project 를 만들지 못했다");
  }

  const name = unique("repo-");
  const repositoryRows = await tx
    .insert(repositories)
    .values({
      workspaceId,
      projectId,
      provider: "GITHUB",
      externalRepositoryId: unique("ext-"),
      owner: "acme",
      name,
      fullName: `acme/${name}`,
    })
    .returning({ id: repositories.id });
  const repositoryId = repositoryRows[0]?.id;
  if (repositoryId === undefined) {
    throw new Error("시험용 Repository 를 만들지 못했다");
  }

  const sessionRows = await tx
    .insert(reviewSessions)
    .values({
      workspaceId,
      repositoryId,
      targetType: "COMMIT",
      commitSha: "a81f3c2",
      reviewerType: "AGENT",
      reviewerName: "codex",
    })
    .returning({ id: reviewSessions.id });
  const reviewSessionId = sessionRows[0]?.id;
  if (reviewSessionId === undefined) {
    throw new Error("시험용 ReviewSession 을 만들지 못했다");
  }

  return { workspaceId, reviewSessionId, repositoryId };
}

async function makeIssue(tx: DbExecutor, fixture: Fixture): Promise<string> {
  const rows = await tx
    .insert(reviewIssues)
    .values({
      workspaceId: fixture.workspaceId,
      reviewSessionId: fixture.reviewSessionId,
      repositoryId: fixture.repositoryId,
      title: unique("issue-"),
      severity: "LOW",
      category: "TESTING",
    })
    .returning({ id: reviewIssues.id });
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 Issue 를 만들지 못했다");
  }
  return id;
}

/** 분 단위로 벌어진 Activity 들. `ordinal` 이 `null` 이면 배포 창에 들어온 행이다. */
async function addActivities(
  tx: DbExecutor,
  fixture: Fixture,
  issueId: string,
  rows: readonly { actor: string; minute: number; ordinal: number | null }[],
): Promise<void> {
  await tx.insert(issueActivities).values(
    rows.map((row) => ({
      workspaceId: fixture.workspaceId,
      reviewIssueId: issueId,
      type: "COMMENT" as const,
      actorType: "AGENT" as const,
      actorName: row.actor,
      createdAt: new Date(
        Date.UTC(2026, 8, 1, 0, row.minute, 0),
      ),
      ordinal: row.ordinal,
    })),
  );
}

async function orderedActors(
  tx: DbExecutor,
  issueId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ actorName: issueActivities.actorName })
    .from(issueActivities)
    .where(eq(issueActivities.reviewIssueId, issueId))
    .orderBy(asc(issueActivities.ordinal));
  return rows.map((row) => row.actorName);
}

async function ordinalsOf(
  tx: DbExecutor,
  issueId: string,
): Promise<(number | null)[]> {
  const rows = await tx
    .select({ ordinal: issueActivities.ordinal })
    .from(issueActivities)
    .where(eq(issueActivities.reviewIssueId, issueId))
    .orderBy(asc(issueActivities.ordinal));
  return rows.map((row) => row.ordinal);
}

describe.skipIf(!enabled)("0015 backfill — 쌓여 있던 행을 채운다", () => {
  it("순번이 없던 행이 시각 순서로 1..n 이 된다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const issueId = await makeIssue(tx, fixture);
      await addActivities(tx, fixture, issueId, [
        { actor: "셋째", minute: 3, ordinal: null },
        { actor: "첫째", minute: 1, ordinal: null },
        { actor: "둘째", minute: 2, ordinal: null },
      ]);

      await tx.execute(sql.raw(backfillOf0015()));

      expect(await orderedActors(tx, issueId)).toEqual([
        "첫째",
        "둘째",
        "셋째",
      ]);
      expect(await ordinalsOf(tx, issueId)).toEqual([1, 2, 3]);
    });
  });

  /**
   * 🔴 **이미 채워진 행을 건드리지 않는다.** `WHERE ordinal IS NULL` 과 「그 Issue 의 현재
   * 최대값 뒤에서 잇기」가 함께 있어야 성립하는 성질이라, 둘 중 하나만 빠져도 깨진다.
   */
  it("다시 돌려도 채워진 것은 그대로고 빈 것만 이어 붙는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const issueId = await makeIssue(tx, fixture);
      await addActivities(tx, fixture, issueId, [
        { actor: "이미1", minute: 1, ordinal: 1 },
        { actor: "이미2", minute: 2, ordinal: 2 },
        { actor: "나중", minute: 3, ordinal: null },
      ]);

      const backfill = backfillOf0015();
      await tx.execute(sql.raw(backfill));
      // 한 번 더 돌려도 아무것도 달라지지 않는다.
      await tx.execute(sql.raw(backfill));

      expect(await orderedActors(tx, issueId)).toEqual([
        "이미1",
        "이미2",
        "나중",
      ]);
      expect(await ordinalsOf(tx, issueId)).toEqual([1, 2, 3]);
    });
  });
});

describe.skipIf(!enabled)("0016 — 배포 창에 끼어든 행을 제자리에 넣는다", () => {
  /**
   * 🔴 **이것이 `0016` 의 존재 이유다.**
   *
   * 배포 창에 들어온 행은 `ordinal` 이 비어 있고, 그 «뒤»에 들어온 행은 `MAX + 1` 을 받는다.
   * `MAX` 는 `NULL` 을 세지 않으므로 창의 행이 그보다 뒤 번호를 갖지 못한다 — 번호를 이어
   * 붙이는 것으로는 고칠 수 없고 그 Issue 를 통째로 다시 매겨야 한다.
   */
  it("번호 사이에 낀 빈 행이 시각 그대로의 자리로 간다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const issueId = await makeIssue(tx, fixture);
      await addActivities(tx, fixture, issueId, [
        { actor: "앞", minute: 1, ordinal: 1 },
        { actor: "창에서", minute: 2, ordinal: null },
        { actor: "창뒤", minute: 3, ordinal: 2 },
      ]);

      await runAll(tx, statementsOf("0016_window_ordinal_backfill.sql"));

      expect(await orderedActors(tx, issueId)).toEqual([
        "앞",
        "창에서",
        "창뒤",
      ]);
      expect(await ordinalsOf(tx, issueId)).toEqual([1, 2, 3]);
    });
  });

  /**
   * 🔴 **고정된 상수로 밀면 여기서 깨진다.**
   *
   * 예전 판은 `ordinal - 1000000000` 이었다. 순번이 10억을 넘으면 뺀 결과가 다시 «양수»가
   * 되고, 그 값이 하필 새로 매기는 `1..n` 안에 떨어지면 unique 와 부딪혀 `23505` 다.
   *
   * 🔴 **값을 아무거나 크게 잡으면 이 시험은 아무것도 잡지 못한다.** 15억을 밀면 5억이
   * 되는데 그것은 `1..3` 과 겹치지 않아 **고친 판이든 옛 판이든 초록**이다 — 실제로 그렇게
   * 써 놓고 되돌림 확인이 통과해 버려서 알았다. 그래서 **밀린 값이 정확히 재배열 범위 안에
   * 떨어지는** `1_000_000_002` 를 쓴다.
   *
   * 지금 판은 그 Issue 의 최대값만큼 밀어 결과가 **반드시 음수**라 어떤 값에서도 겹치지 않는다.
   */
  it("🔴 밀린 값이 재배열 범위에 떨어져도 겹치지 않는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const issueId = await makeIssue(tx, fixture);
      await addActivities(tx, fixture, issueId, [
        // 고정 상수 판에서는 `1_000_000_002 - 1_000_000_000 = 2` 가 되어 새 번호 2 와 부딪힌다.
        { actor: "거대1", minute: 1, ordinal: 1_000_000_002 },
        { actor: "창에서", minute: 2, ordinal: null },
        { actor: "거대2", minute: 3, ordinal: 2_000_000_000 },
      ]);

      await runAll(tx, statementsOf("0016_window_ordinal_backfill.sql"));

      expect(await orderedActors(tx, issueId)).toEqual([
        "거대1",
        "창에서",
        "거대2",
      ]);
      expect(await ordinalsOf(tx, issueId)).toEqual([1, 2, 3]);
    });
  });

  /** `integer` 상한. 미는 폭이 그 값에 묶여 있어야 넘치지 않는다. */
  it("🔴 순번이 integer 상한이어도 넘치지 않는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const issueId = await makeIssue(tx, fixture);
      await addActivities(tx, fixture, issueId, [
        { actor: "하나", minute: 1, ordinal: 1 },
        { actor: "창에서", minute: 2, ordinal: null },
        { actor: "상한", minute: 3, ordinal: 2_147_483_647 },
      ]);

      await runAll(tx, statementsOf("0016_window_ordinal_backfill.sql"));

      expect(await ordinalsOf(tx, issueId)).toEqual([1, 2, 3]);
    });
  });

  /** 그 Issue 의 최대값이 `NULL` 인 경우 — 미는 문장이 한 행도 고르지 못한다. */
  it("순번이 하나도 없던 Issue 도 1..n 이 된다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const issueId = await makeIssue(tx, fixture);
      await addActivities(tx, fixture, issueId, [
        { actor: "널2", minute: 2, ordinal: null },
        { actor: "널1", minute: 1, ordinal: null },
      ]);

      await runAll(tx, statementsOf("0016_window_ordinal_backfill.sql"));

      expect(await orderedActors(tx, issueId)).toEqual(["널1", "널2"]);
      expect(await ordinalsOf(tx, issueId)).toEqual([1, 2]);
    });
  });

  /** 🔴 **빈 행이 없는 Issue 는 손대지 않는다** — 대상 밖의 순번이 흔들리면 안 된다. */
  it("빈 행이 없는 Issue 는 번호가 그대로다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const untouched = await makeIssue(tx, fixture);
      const target = await makeIssue(tx, fixture);

      await addActivities(tx, fixture, untouched, [
        { actor: "가만히1", minute: 1, ordinal: 10 },
        { actor: "가만히2", minute: 2, ordinal: 20 },
      ]);
      await addActivities(tx, fixture, target, [
        { actor: "빈행", minute: 1, ordinal: null },
      ]);

      await runAll(tx, statementsOf("0016_window_ordinal_backfill.sql"));

      // 대상이 아닌 Issue 는 10·20 을 그대로 갖는다.
      expect(await ordinalsOf(tx, untouched)).toEqual([10, 20]);
      expect(await ordinalsOf(tx, target)).toEqual([1]);
    });
  });

  /** 두 번 돌려도 결과가 같다 — 남은 `NULL` 이 없으면 대상이 0개다. */
  it("다시 돌려도 결과가 달라지지 않는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const issueId = await makeIssue(tx, fixture);
      await addActivities(tx, fixture, issueId, [
        { actor: "앞", minute: 1, ordinal: 1 },
        { actor: "창에서", minute: 2, ordinal: null },
        { actor: "창뒤", minute: 3, ordinal: 2 },
      ]);

      const statements = statementsOf("0016_window_ordinal_backfill.sql");
      await runAll(tx, statements);
      const once = await orderedActors(tx, issueId);
      await runAll(tx, statements);

      expect(await orderedActors(tx, issueId)).toEqual(once);
      expect(await ordinalsOf(tx, issueId)).toEqual([1, 2, 3]);
    });
  });
});
