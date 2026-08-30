import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  issueCodeEvidences,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { verifyCodeEvidence } from "@/features/issues/server/code-evidence-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **끝내 보지 못한 Code Evidence 를 닫는 자리**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                       # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있고 DATABASE_URL 이 있어야 한다
 * ```
 *
 * # 무엇을 붙드는가
 *
 * 한 요청에서 GitHub 에 물어보는 근거는 **10개까지**다(`MAX_VERIFY_PER_REQUEST`).
 * 그 상한을 넘은 행은 **어떤 경로도 다시 큐에 넣지 않으므로**, 그냥 두면 영원히 초기값
 * `UNVERIFIED` 에 머문다 — 화면이 「아직 확인 중」과 「영영 확인되지 않는다」를 구분하지
 * 못한다. `closeOutUnverified` 가 그것을 `UNAVAILABLE` 로 닫는다.
 *
 * 🔴 **그 동작은 지금까지 «렌더된 SQL 문자열»로만 확인됐고 한 번도 실행된 적이 없다.**
 * 문장이 무엇을 실제로 바꾸는지는 진짜 Database 만 안다.
 *
 * # 🔴 GitHub 왕복은 막는다 — Database 만 진짜다
 *
 * 이 시험은 `fetch` 를 stub 한다. 확인하려는 것은 **행이 어떻게 닫히는가**이지
 * GitHub 이 무엇을 돌려주는가가 아니다. 시험이 네트워크에 나가면 GitHub 이 흔들릴 때마다
 * 코드에 아무 문제가 없는데도 빨간불이 켜진다.
 *
 * # 🔴 「GitHub 이 아닌 Provider」는 여기서 재현할 수 없다
 *
 * `verifyCodeEvidence` 는 `provider !== "GITHUB"` 인 행을 건너뛰어 같은 자리에서 닫는다.
 * 그런데 `scm_provider` enum 의 값은 **`GITHUB` 하나뿐**이라(`src/types/review.ts`)
 * 그런 행을 Database 에 만들 수가 없다 — 지금은 **도달할 수 없는 분기**다.
 * 값이 늘어나는 날 이 파일에 그 경우를 더한다.
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
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

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `fixrp-${prefix}${Date.now().toString(36)}${seq}`;
}

const COMMIT = "a81f3c2";
const FILE = "src/app.ts";
/** GitHub 이 돌려줄 파일. 근거의 snapshot 과 «같아야» `VERIFIED` 다. */
const LINE = "const a = 1;";

/**
 * GitHub 을 대신한다.
 *
 * | 부르는 곳 | 돌려주는 것 |
 * |---|---|
 * | `GET /repos/{o}/{n}` | `{ private: false }` — 공개 저장소다 |
 * | `GET /repos/{o}/{n}/contents/…` | `LINE` — 근거와 같은 코드다 |
 *
 * 🔴 **네트워크로 나가지 않는다.** 다른 주소를 부르면 그 자리에서 터뜨린다 —
 * 조용히 404 를 주면 시험이 엉뚱한 이유로 통과한다.
 */
function stubGithub(): void {
  vi.stubGlobal("fetch", (input: unknown) => {
    const url = String(input);
    if (url.includes("/contents/")) {
      return Promise.resolve(new Response(`${LINE}\n`, { status: 200 }));
    }
    if (url.includes("/repos/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ private: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.reject(new Error(`시험이 예상하지 않은 곳을 불렀다: ${url}`));
  });
}

/** Workspace -> Project -> Repository -> Session -> Issue 를 한 벌 만든다. */
async function seedIssue(
  tx: DbExecutor,
): Promise<{ workspaceId: string; reviewIssueId: string }> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "fixrp" })
    .returning({ id: users.id });

  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: "fixrp", slugSource: unique("ws-") },
    tx,
  );

  const projectRows = await tx
    .insert(projects)
    .values({ workspaceId, name: "fixrp", slug: unique("p-") })
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
      commitSha: COMMIT,
      reviewerType: "AGENT",
      reviewerName: "codex",
    })
    .returning({ id: reviewSessions.id });
  const reviewSessionId = sessionRows[0]?.id;
  if (reviewSessionId === undefined) {
    throw new Error("시험용 ReviewSession 을 만들지 못했다");
  }

  const issueRows = await tx
    .insert(reviewIssues)
    .values({
      workspaceId,
      repositoryId,
      reviewSessionId,
      title: "근거가 달린 문제",
      severity: "HIGH",
      category: "TRANSACTION",
    })
    .returning({ id: reviewIssues.id });
  const reviewIssueId = issueRows[0]?.id;
  if (reviewIssueId === undefined) {
    throw new Error("시험용 ReviewIssue 를 만들지 못했다");
  }

  return { workspaceId, reviewIssueId };
}

async function seedEvidence(
  tx: DbExecutor,
  input: { workspaceId: string; reviewIssueId: string; count: number },
): Promise<string[]> {
  const rows = await tx
    .insert(issueCodeEvidences)
    .values(
      Array.from({ length: input.count }, () => ({
        workspaceId: input.workspaceId,
        reviewIssueId: input.reviewIssueId,
        kind: "BEFORE" as const,
        commitSha: COMMIT,
        filePath: FILE,
        startLine: 1,
        endLine: 1,
        snapshot: LINE,
      })),
    )
    .returning({ id: issueCodeEvidences.id });

  return rows.map((row) => row.id);
}

async function readVerification(
  tx: DbExecutor,
  ids: readonly string[],
): Promise<Map<string, { verification: string; verifiedAt: Date | null }>> {
  const rows = await tx
    .select({
      id: issueCodeEvidences.id,
      verification: issueCodeEvidences.verification,
      verifiedAt: issueCodeEvidences.verifiedAt,
    })
    .from(issueCodeEvidences)
    .where(inArray(issueCodeEvidences.id, [...ids]));

  return new Map(
    rows.map((row) => [
      row.id,
      { verification: row.verification, verifiedAt: row.verifiedAt },
    ]),
  );
}

describe.skipIf(!enabled)("확인하지 못한 Code Evidence 닫기", () => {
  /**
   * # 🔴 상한(10)을 넘은 근거가 `UNVERIFIED` 로 남지 않는다
   *
   * 근거 12개를 넣고 한 번 확인한다. 조회가 **앞에서 10개만** 집어 가므로
   * (`orderBy(createdAt, id) limit 10`, 한 Transaction 안이라 `createdAt` 이 전부 같아
   * 실제 순서는 `id` 다) 나머지 둘은 **GitHub 에 물어보지도 않는다.**
   *
   * 🔴 그 둘이 `UNAVAILABLE` 이 되는 유일한 경로가 `closeOutUnverified` 다.
   */
  it("🔴 GitHub 에 물어보지 못한 근거가 UNAVAILABLE 로 닫힌다", async () => {
    await inRollback(async (tx) => {
      const { workspaceId, reviewIssueId } = await seedIssue(tx);
      const ids = await seedEvidence(tx, {
        workspaceId,
        reviewIssueId,
        count: 12,
      });

      const before = await readVerification(tx, ids);
      expect(
        [...before.values()].every(
          (row) => row.verification === "UNVERIFIED" && row.verifiedAt === null,
        ),
      ).toBe(true);

      stubGithub();
      await verifyCodeEvidence(workspaceId, ids, tx);

      const after = await readVerification(tx, ids);

      // 🔴 이 호출이 끝나면 `UNVERIFIED` 가 하나도 남지 않는다.
      expect(
        [...after.values()].filter((row) => row.verification === "UNVERIFIED"),
      ).toHaveLength(0);

      /**
       * 🔴 **어느 둘이 상한 밖이었는지까지 못 박는다.** `id` 오름차순으로 앞의 열이
       * 확인되고 뒤의 둘이 남는다 — 그 둘만 `UNAVAILABLE` 이다.
       */
      const ordered = [...ids].sort();
      const verified = ordered.slice(0, 10);
      const closed = ordered.slice(10);

      expect(
        verified.map((id) => after.get(id)?.verification),
      ).toEqual(Array.from({ length: 10 }, () => "VERIFIED"));
      expect(closed.map((id) => after.get(id)?.verification)).toEqual([
        "UNAVAILABLE",
        "UNAVAILABLE",
      ]);
      // 닫힌 행에도 「언제 결론 났는지」가 남는다.
      expect(
        closed.every((id) => after.get(id)?.verifiedAt instanceof Date),
      ).toBe(true);
    });
  });

  /**
   * 🔴 **닫는 문장도 id 만으로 행을 찾지 않는다.**
   *
   * 남의 Workspace 의 근거 id 를 목록에 끼워 넣어도 그 행은 그대로다 — 조회에도
   * UPDATE 에도 `workspace_id` 가 함께 걸려 있다(CLAUDE.md 11).
   */
  it("🔴 남의 Workspace 의 근거는 닫지 않는다", async () => {
    await inRollback(async (tx) => {
      const mine = await seedIssue(tx);
      const theirs = await seedIssue(tx);

      const [mineId] = await seedEvidence(tx, { ...mine, count: 1 });
      const [theirsId] = await seedEvidence(tx, { ...theirs, count: 1 });
      if (mineId === undefined || theirsId === undefined) {
        throw new Error("시험용 Evidence 를 만들지 못했다");
      }

      stubGithub();
      await verifyCodeEvidence(mine.workspaceId, [mineId, theirsId], tx);

      const after = await readVerification(tx, [mineId, theirsId]);

      expect(after.get(mineId)?.verification).toBe("VERIFIED");
      // 🔴 남의 행은 손대지 않았다 — 닫히지도 않았다.
      expect(after.get(theirsId)?.verification).toBe("UNVERIFIED");
      expect(after.get(theirsId)?.verifiedAt).toBeNull();
    });
  });
});
