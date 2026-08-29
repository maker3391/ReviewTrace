import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  accounts,
  apiKeys,
  issueActivities,
  knowledgePages,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  sessions,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  deleteAccount,
  findAccountDeletionImpact,
} from "@/features/users/server/account-deletion-service";
import { changeMemberRole } from "@/features/workspaces/server/workspace-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";
import { isAppError } from "@/lib/errors";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **계정 삭제**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                       # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있고 .env 에 DATABASE_URL 이 있어야 한다
 * ```
 *
 * **기본 실행이 초록인 것은 계정 삭제가 안전하다는 근거가 아니다.** 계정 삭제의 위험은
 * 전부 **Database 가 실제로 무엇을 함께 지우는가**에 있고, 그것은 Fake 로 증명되지 않는다.
 * 🔴 Fake 는 `where` 를 해석하지 않고 `ON DELETE CASCADE` 도 흉내내지 못한다 —
 * 이 저장소에서 실제로 「Fake 가 `where` 를 무시해 가짜 초록」이 났던 자리다.
 *
 * 아래는 `DB_INTEGRATION=true` 없이는 **한 번도 확인되지 않는다**:
 *
 * - `users` 한 행을 지웠을 때 **CASCADE 가 어디까지 번지는가**(실측)
 * - 남의 Workspace 의 Review Knowledge 가 **정말 살아남는가**
 * - `FOR UPDATE` 를 건 마지막 OWNER 판정이 실제로 삭제를 막는가
 * - 세션·OAuth 계정 신원이 **전 기기에서** 사라지는가
 * - 초대 행에 남은 이메일이 지워지는가
 * - 남는 Personal Workspace 의 slug 가 실제로 회전하는가
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 * 있는 데이터를 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다 —
 * **실제 계정은 이 파일이 한 번도 건드리지 않는다.**
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

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

interface Person {
  userId: string;
  email: string;
  workspaceId: string;
  slug: string;
}

/** 실제 가입 경로를 그대로 쓴다 — 사용자 + Personal Workspace + OWNER 소속. */
async function signUp(tx: DbExecutor, label: string): Promise<Person> {
  const email = `${unique("u")}@example.test`;
  const created = await tx
    .insert(users)
    .values({ email, name: label, image: "https://example.test/a.png" })
    .returning({ id: users.id });

  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  // slug 재료는 GitHub 아이디다. 실제 가입과 같은 자리를 쓴다.
  const githubLogin = unique("gh-");
  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: label, slugSource: githubLogin },
    tx,
  );

  const rows = await tx
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  return { userId, email, workspaceId, slug: rows[0]?.slug ?? "" };
}

/** 로그인 흔적 — OAuth 계정 연결과 서버 세션 두 개(기기 둘). */
async function signIn(tx: DbExecutor, person: Person): Promise<void> {
  await tx.insert(accounts).values({
    userId: person.userId,
    type: "oauth",
    provider: "github",
    providerAccountId: unique("ghid-"),
    scope: "read:user user:email",
  });

  const expires = new Date(Date.now() + 86_400_000);
  await tx.insert(sessions).values([
    { sessionToken: unique("st-"), userId: person.userId, expires },
    { sessionToken: unique("st-"), userId: person.userId, expires },
  ]);
}

/** Project -> Repository -> ReviewSession -> ReviewIssue -> IssueActivity 한 벌. */
async function seedKnowledge(
  tx: DbExecutor,
  input: { workspaceId: string; createdBy: string; actorName: string },
): Promise<{ projectId: string; issueId: string }> {
  const projectRows = await tx
    .insert(projects)
    .values({
      workspaceId: input.workspaceId,
      slug: unique("p-"),
      name: "SMIL",
      createdBy: input.createdBy,
    })
    .returning({ id: projects.id });

  const projectId = projectRows[0]?.id;
  if (projectId === undefined) {
    throw new Error("시험용 Project 를 만들지 못했다");
  }

  const repositoryRows = await tx
    .insert(repositories)
    .values({
      workspaceId: input.workspaceId,
      projectId,
      provider: "GITHUB",
      externalRepositoryId: unique("ext-"),
      owner: "acme",
      name: "svc",
      fullName: "acme/svc",
    })
    .returning({ id: repositories.id });

  const repositoryId = repositoryRows[0]?.id;
  if (repositoryId === undefined) {
    throw new Error("시험용 Repository 를 만들지 못했다");
  }

  const sessionRows = await tx
    .insert(reviewSessions)
    .values({
      workspaceId: input.workspaceId,
      repositoryId,
      targetType: "COMMIT",
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
      workspaceId: input.workspaceId,
      repositoryId,
      reviewSessionId,
      title: "External API call inside DB transaction",
      severity: "HIGH",
      category: "TRANSACTION",
      patternKey: "EXTERNAL_IO_IN_TRANSACTION",
    })
    .returning({ id: reviewIssues.id });

  const issueId = issueRows[0]?.id;
  if (issueId === undefined) {
    throw new Error("시험용 ReviewIssue 를 만들지 못했다");
  }

  await tx.insert(issueActivities).values({
    workspaceId: input.workspaceId,
    reviewIssueId: issueId,
    type: "FIX_ATTEMPTED",
    actorType: "HUMAN",
    actorName: input.actorName,
    description: "Transaction 밖으로 옮겼다",
  });

  await tx.insert(knowledgePages).values({
    workspaceId: input.workspaceId,
    projectId: null,
    title: "금액 표기 규칙",
    slug: unique("k-"),
    content: "# 규칙",
    createdBy: input.createdBy,
  });

  await tx.insert(apiKeys).values({
    workspaceId: input.workspaceId,
    name: "codex-ci",
    keyPrefix: unique("ci_"),
    keyHash: unique("hash-"),
  });

  return { projectId, issueId };
}

/** 조건에 맞는 행 수. 🔴 세는 일은 Database 가 한다. */
async function countRows(
  tx: DbExecutor,
  query: Promise<{ value: number }[]>,
): Promise<number> {
  const rows = await query;
  return rows[0]?.value ?? 0;
}

const total = sql<number>`cast(count(*) as int)`;

describe.skipIf(!enabled)("계정 삭제 — 혼자 쓰던 것", () => {
  it("🔴 Personal Workspace 가 계정과 함께 사라진다 — GitHub 아이디가 주소에 남지 않는다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "혼자");
      await signIn(tx, me);
      await seedKnowledge(tx, {
        workspaceId: me.workspaceId,
        createdBy: me.userId,
        actorName: "혼자",
      });

      await deleteAccount({ userId: me.userId }, tx);

      const left = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, me.workspaceId));
      expect(left).toHaveLength(0);

      // 🔴 slug 가 통째로 사라졌으니 그 GitHub 아이디를 다시 쓸 수 있다.
      const bySlug = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, me.slug));
      expect(bySlug).toHaveLength(0);
    });
  });

  it("🔴 CASCADE 범위 실측 — Project·Repository·Review·Issue·Activity·Wiki·API Key 가 함께 사라진다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "혼자");
      await seedKnowledge(tx, {
        workspaceId: me.workspaceId,
        createdBy: me.userId,
        actorName: "혼자",
      });

      const scope = me.workspaceId;
      const before = {
        projects: await countRows(
          tx,
          tx.select({ value: total }).from(projects).where(eq(projects.workspaceId, scope)),
        ),
        issues: await countRows(
          tx,
          tx.select({ value: total }).from(reviewIssues).where(eq(reviewIssues.workspaceId, scope)),
        ),
        activities: await countRows(
          tx,
          tx.select({ value: total }).from(issueActivities).where(eq(issueActivities.workspaceId, scope)),
        ),
        keys: await countRows(
          tx,
          tx.select({ value: total }).from(apiKeys).where(eq(apiKeys.workspaceId, scope)),
        ),
      };
      expect(before).toEqual({ projects: 1, issues: 1, activities: 1, keys: 1 });

      await deleteAccount({ userId: me.userId }, tx);

      for (const query of [
        tx.select({ value: total }).from(projects).where(eq(projects.workspaceId, scope)),
        tx.select({ value: total }).from(repositories).where(eq(repositories.workspaceId, scope)),
        tx.select({ value: total }).from(reviewSessions).where(eq(reviewSessions.workspaceId, scope)),
        tx.select({ value: total }).from(reviewIssues).where(eq(reviewIssues.workspaceId, scope)),
        tx.select({ value: total }).from(issueActivities).where(eq(issueActivities.workspaceId, scope)),
        tx.select({ value: total }).from(knowledgePages).where(eq(knowledgePages.workspaceId, scope)),
        tx.select({ value: total }).from(apiKeys).where(eq(apiKeys.workspaceId, scope)),
        tx.select({ value: total }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, scope)),
      ]) {
        expect(await countRows(tx, query)).toBe(0);
      }
    });
  });
});

describe.skipIf(!enabled)("계정 삭제 — 인증 흔적", () => {
  it("🔴 전 기기의 세션이 끊긴다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const other = await signUp(tx, "남");
      await signIn(tx, me);
      await signIn(tx, other);

      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(sessions).where(eq(sessions.userId, me.userId)),
        ),
      ).toBe(2);

      await deleteAccount({ userId: me.userId }, tx);

      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(sessions).where(eq(sessions.userId, me.userId)),
        ),
      ).toBe(0);
      // 🔴 남의 세션은 그대로다.
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(sessions).where(eq(sessions.userId, other.userId)),
        ),
      ).toBe(2);
    });
  });

  it("🔴 OAuth 계정 연결(provider_account_id)이 남지 않는다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      await signIn(tx, me);

      await deleteAccount({ userId: me.userId }, tx);

      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(accounts).where(eq(accounts.userId, me.userId)),
        ),
      ).toBe(0);
    });
  });

  it("🔴 이메일·이름·이미지가 남지 않는다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");

      await deleteAccount({ userId: me.userId }, tx);

      const left = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, me.email));
      expect(left).toHaveLength(0);
    });
  });

  it("🔴 내 이메일이 적힌 초대 행이 지워진다 — 남의 이메일은 그대로다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const host = await signUp(tx, "초대한 사람");
      const otherEmail = `${unique("x")}@example.test`;
      const expiresAt = new Date(Date.now() + 86_400_000);

      /*
        🔴 **Column 을 손으로 적는다.** Drizzle 의 `insert` 는 표의 «모든» Column 을
        문장에 적기 때문에, 이 시험이 초대 기능의 Schema 변경과 함께 흔들린다 —
        여기서 확인하려는 것은 「이메일이 적힌 행이 지워지는가」 하나뿐이다.
      */
      for (const email of [me.email, otherEmail]) {
        await tx.execute(sql`
          insert into workspace_invitations
            (workspace_id, email, token_hash, expires_at, invited_by)
          values (${host.workspaceId}, ${email}, ${unique("h-")}, ${expiresAt}, ${host.userId})
        `);
      }

      await deleteAccount({ userId: me.userId }, tx);

      expect(
        await countRows(
          tx,
          tx
            .select({ value: total })
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.email, me.email)),
        ),
      ).toBe(0);
      expect(
        await countRows(
          tx,
          tx
            .select({ value: total })
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.email, otherEmail)),
        ),
      ).toBe(1);
    });
  });
});

describe.skipIf(!enabled)("계정 삭제 — 남의 것은 건드리지 않는다", () => {
  it("🔴 남의 Workspace 와 Review Knowledge 가 그대로 남는다", async () => {
    await inRollback(async (tx) => {
      const owner = await signUp(tx, "팀장");
      const me = await signUp(tx, "나");
      await tx.insert(workspaceMembers).values({
        workspaceId: owner.workspaceId,
        userId: me.userId,
        role: "MEMBER",
      });
      await seedKnowledge(tx, {
        workspaceId: owner.workspaceId,
        createdBy: me.userId,
        actorName: "나",
      });

      await deleteAccount({ userId: me.userId }, tx);

      // Workspace 도 그 안의 Issue 도 그대로다.
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(workspaces).where(eq(workspaces.id, owner.workspaceId)),
        ),
      ).toBe(1);
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(reviewIssues).where(eq(reviewIssues.workspaceId, owner.workspaceId)),
        ),
      ).toBe(1);
      // 🔴 API Key 는 Workspace 의 것이다 — 사람이 나갔다고 팀의 Agent 연동이 끊기지 않는다.
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(apiKeys).where(eq(apiKeys.workspaceId, owner.workspaceId)),
        ),
      ).toBe(1);

      // 소속만 빠진다.
      expect(
        await countRows(
          tx,
          tx
            .select({ value: total })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, owner.workspaceId)),
        ),
      ).toBe(1);
    });
  });

  it("🔴 만든 사람 자리는 비워지고 문서·Project 자체는 남는다", async () => {
    await inRollback(async (tx) => {
      const owner = await signUp(tx, "팀장");
      const me = await signUp(tx, "나");
      await tx.insert(workspaceMembers).values({
        workspaceId: owner.workspaceId,
        userId: me.userId,
        role: "MEMBER",
      });
      await seedKnowledge(tx, {
        workspaceId: owner.workspaceId,
        createdBy: me.userId,
        actorName: "나",
      });

      await deleteAccount({ userId: me.userId }, tx);

      const page = await tx
        .select({ title: knowledgePages.title, createdBy: knowledgePages.createdBy })
        .from(knowledgePages)
        .where(eq(knowledgePages.workspaceId, owner.workspaceId));
      expect(page[0]?.title).toBe("금액 표기 규칙");
      expect(page[0]?.createdBy).toBeNull();

      const project = await tx
        .select({ createdBy: projects.createdBy })
        .from(projects)
        .where(eq(projects.workspaceId, owner.workspaceId));
      expect(project[0]?.createdBy).toBeNull();
    });
  });

  it("🔴 Review 이력의 `actor_name` 은 남는다 — 「누가 고쳤는가」는 Review 기록이다", async () => {
    await inRollback(async (tx) => {
      const owner = await signUp(tx, "팀장");
      const me = await signUp(tx, "나");
      await tx.insert(workspaceMembers).values({
        workspaceId: owner.workspaceId,
        userId: me.userId,
        role: "MEMBER",
      });
      await seedKnowledge(tx, {
        workspaceId: owner.workspaceId,
        createdBy: me.userId,
        actorName: "나",
      });

      await deleteAccount({ userId: me.userId }, tx);

      const activity = await tx
        .select({ actorName: issueActivities.actorName })
        .from(issueActivities)
        .where(eq(issueActivities.workspaceId, owner.workspaceId));
      expect(activity[0]?.actorName).toBe("나");
    });
  });

  it("🔴 한 사람을 지워도 다른 사람의 계정은 통째로 남는다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const other = await signUp(tx, "남");
      await signIn(tx, other);

      await deleteAccount({ userId: me.userId }, tx);

      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(users).where(eq(users.id, other.userId)),
        ),
      ).toBe(1);
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(workspaces).where(eq(workspaces.id, other.workspaceId)),
        ),
      ).toBe(1);
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(accounts).where(eq(accounts.userId, other.userId)),
        ),
      ).toBe(1);
    });
  });
});

describe.skipIf(!enabled)("계정 삭제 — 마지막 OWNER", () => {
  it("🔴 다른 멤버가 있는데 OWNER 가 나뿐이면 삭제가 거절된다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const member = await signUp(tx, "팀원");
      await tx.insert(workspaceMembers).values({
        workspaceId: me.workspaceId,
        userId: member.userId,
        role: "MEMBER",
      });

      const failure = await deleteAccount({ userId: me.userId }, tx).catch(
        (error: unknown) => error,
      );

      expect(isAppError(failure)).toBe(true);
      expect(isAppError(failure) && failure.code).toBe("CONFLICT");

      // 🔴 아무것도 바뀌지 않았다 — 반쪽 삭제가 남지 않는다.
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(users).where(eq(users.id, me.userId)),
        ),
      ).toBe(1);
      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(workspaces).where(eq(workspaces.id, me.workspaceId)),
        ),
      ).toBe(1);
    });
  });

  it("다른 멤버를 OWNER 로 올리면 삭제가 통과하고 Workspace 는 남는다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const member = await signUp(tx, "팀원");
      await tx.insert(workspaceMembers).values({
        workspaceId: me.workspaceId,
        userId: member.userId,
        role: "MEMBER",
      });

      await changeMemberRole(
        { workspaceId: me.workspaceId, userId: member.userId, role: "OWNER" },
        tx,
      );

      await deleteAccount({ userId: me.userId }, tx);

      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(workspaces).where(eq(workspaces.id, me.workspaceId)),
        ),
      ).toBe(1);
      const left = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, me.workspaceId));
      expect(left.map((row) => row.userId)).toEqual([member.userId]);
    });
  });

  it("🔴 남는 Personal Workspace 는 주소가 중립 slug 로 바뀌고 주인 표시가 끊긴다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const member = await signUp(tx, "팀원");
      await tx.insert(workspaceMembers).values({
        workspaceId: me.workspaceId,
        userId: member.userId,
        role: "OWNER",
      });

      await deleteAccount({ userId: me.userId }, tx);

      const left = await tx
        .select({
          slug: workspaces.slug,
          personalOwnerId: workspaces.personalOwnerId,
        })
        .from(workspaces)
        .where(eq(workspaces.id, me.workspaceId));

      expect(left).toHaveLength(1);
      // 🔴 GitHub 아이디에서 나온 주소가 더 이상 아니다.
      expect(left[0]?.slug).not.toBe(me.slug);
      expect(left[0]?.slug.startsWith("w-")).toBe(true);
      expect(left[0]?.personalOwnerId).toBeNull();
    });
  });

  it("🔴 하나가 막히면 지울 수 있었던 Workspace 도 그대로 남는다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const member = await signUp(tx, "팀원");
      // 팀원이 내 Personal Workspace 에 들어와 있고 OWNER 는 나뿐이다.
      await tx.insert(workspaceMembers).values({
        workspaceId: me.workspaceId,
        userId: member.userId,
        role: "MEMBER",
      });
      // 혼자 쓰는 Workspace 를 하나 더 갖고 있다.
      const soloRows = await tx
        .insert(workspaces)
        .values({ slug: unique("solo-"), name: "Solo", createdBy: me.userId })
        .returning({ id: workspaces.id });
      const soloId = soloRows[0]?.id;
      if (soloId === undefined) {
        throw new Error("시험용 Workspace 를 만들지 못했다");
      }
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: soloId, userId: me.userId, role: "OWNER" });

      await deleteAccount({ userId: me.userId }, tx).catch(() => undefined);

      expect(
        await countRows(
          tx,
          tx.select({ value: total }).from(workspaces).where(eq(workspaces.id, soloId)),
        ),
      ).toBe(1);
    });
  });
});

describe.skipIf(!enabled)("계정 삭제 미리보기", () => {
  it("무엇이 사라지고 무엇이 남는지 실제 상태로 센다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const host = await signUp(tx, "팀장");
      await tx.insert(workspaceMembers).values({
        workspaceId: host.workspaceId,
        userId: me.userId,
        role: "MEMBER",
      });
      await seedKnowledge(tx, {
        workspaceId: me.workspaceId,
        createdBy: me.userId,
        actorName: "나",
      });

      const impact = await findAccountDeletionImpact(me.userId, tx);

      expect(impact.deletable).toBe(true);
      expect(impact.deleted.map((entry) => entry.workspaceId)).toEqual([
        me.workspaceId,
      ]);
      expect(impact.preserved.map((entry) => entry.workspaceId)).toEqual([
        host.workspaceId,
      ]);
      expect(impact.losses).toEqual({
        projects: 1,
        reviewIssues: 1,
        knowledgePages: 1,
        apiKeys: 1,
      });
      // 확인 문구는 Personal Workspace 의 slug 다.
      expect(impact.confirmValue).toBe(me.slug);
    });
  });

  it("🔴 미리보기도 막힌 Workspace 를 그대로 알려 준다 — 화면이 조건을 말할 수 있어야 한다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const member = await signUp(tx, "팀원");
      await tx.insert(workspaceMembers).values({
        workspaceId: me.workspaceId,
        userId: member.userId,
        role: "MEMBER",
      });

      const impact = await findAccountDeletionImpact(me.userId, tx);

      expect(impact.deletable).toBe(false);
      expect(impact.blocked.map((entry) => entry.slug)).toEqual([me.slug]);
    });
  });

  it("🔴 남의 Workspace 는 미리보기에 나오지 않는다", async () => {
    await inRollback(async (tx) => {
      const me = await signUp(tx, "나");
      const stranger = await signUp(tx, "모르는 사람");

      const impact = await findAccountDeletionImpact(me.userId, tx);

      const seen = [...impact.deleted, ...impact.preserved, ...impact.blocked];
      expect(
        seen.some((entry) => entry.workspaceId === stranger.workspaceId),
      ).toBe(false);
    });
  });
});

describe.skipIf(!enabled)("계정 삭제 — 없는 계정", () => {
  it("없는 사용자를 지우려 하면 NOT_FOUND 다", async () => {
    await inRollback(async (tx) => {
      const failure = await deleteAccount(
        { userId: "00000000-0000-0000-0000-000000000000" },
        tx,
      ).catch((error: unknown) => error);

      expect(isAppError(failure) && failure.code).toBe("NOT_FOUND");
    });
  });
});
