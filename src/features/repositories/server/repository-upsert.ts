import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db";
import { repositories } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { ScmProvider } from "@/types/review";

/**
 * Agent 가 보낸 Repository 를 이 Workspace 의 한 행으로 맞춘다(스펙 7).
 *
 * ## 🔴 왜 `externalRepositoryId` 를 필수에서 뺐는가
 *
 * Agent 가 아는 것은 **git remote** 다. `git remote get-url origin` 은 `owner/name` 을
 * 주지만 GitHub 의 숫자 id 는 주지 않는다 — 그것을 알려면 Agent 가 GitHub API 를 따로
 * 불러야 하고, 그러려면 Agent 에게 GitHub Token 을 쥐여 줘야 한다.
 * **기록 하나 남기자고 Agent 에게 저장소 접근 권한을 요구하지 않는다.**
 *
 * ## 그래서 신원을 어떻게 잡는가
 *
 * | 보낸 것 | 신원 |
 * |---|---|
 * | 숫자 id 있음 | 그 id. **이름이 바뀌어도 같은 저장소로 남는다** |
 * | 숫자 id 없음 | `fullname:owner/name`(소문자). Rename 하면 갈라진다 |
 *
 * 🔴 **둘이 갈라지지 않게 꿰맨다.** 이름으로 만들어 둔 행에 나중에 숫자 id 가 오면
 * **그 행의 신원을 숫자 id 로 승격**한다 — 같은 저장소가 두 행이 되어 Knowledge 가
 * 끊기는 것을 막는다. 반대 방향(숫자 id 행에 이름만 오는 것)은 이름으로 먼저 찾으므로
 * 애초에 갈라지지 않는다.
 */

/** 숫자 id 없이 만들어진 행임을 드러내는 접두. 사람이 봐도 구분되게 남긴다. */
const FALLBACK_PREFIX = "fullname:";

export function fallbackExternalId(fullName: string): string {
  return `${FALLBACK_PREFIX}${fullName.toLowerCase()}`;
}

export interface RepositoryUpsertInput {
  provider: ScmProvider;
  externalRepositoryId: string | null;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string | null;
}

export async function resolveIngestRepository(
  tx: DbExecutor,
  workspaceId: string,
  projectId: string,
  input: RepositoryUpsertInput,
): Promise<string> {
  /**
   * 🔴 **이름으로 찾아서 없으면 넣는 사이**를 다른 요청이 파고들 수 있다.
   *
   * 같은 저장소의 첫 Review 두 개가 동시에 오는데 한쪽만 숫자 id 를 보내면, 둘 다
   * 「기존 행 없음」을 보고 각각 `100` 과 `fullname:acme/app` 으로 INSERT 한다 —
   * Unique 제약이 서로 다른 값이라 **둘 다 성공**하고, 같은 저장소가 두 행으로 갈라져
   * 이후 Review 와 Knowledge 가 나뉘어 쌓인다.
   *
   * Unique 제약은 「같은 값」만 막는다. 여기서 막아야 하는 것은 「같은 저장소를 가리키는
   * 서로 다른 값」이라 제약으로는 표현할 수 없다 — 그래서 그 구간을 Workspace+이름 단위로
   * 직렬화한다. Transaction 이 끝나면 자동으로 풀리는 잠금이라 따로 놓아 줄 것이 없다.
   */
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${input.provider}:${input.fullName.toLowerCase()}`}, 0))`,
  );

  const now = new Date();
  const nameFields = {
    owner: input.owner,
    name: input.name,
    fullName: input.fullName,
    defaultBranch: input.defaultBranch,
    htmlUrl: input.htmlUrl,
    updatedAt: now,
  };

  /**
   * 1. 숫자 id 를 보냈으면 **그것으로 먼저 찾는다.**
   *
   * 🔴 이름을 먼저 보면 안 된다. GitHub 에서 `acme/app`(id 100)이 지워지고 같은 이름으로
   * 새 저장소(id 200)가 만들어진 경우, 이름 조회는 **지워진 저장소의 행**을 준다 —
   * 서로 다른 저장소의 Review 와 Knowledge 가 한 줄기로 합쳐진다.
   * 숫자 id 는 이름과 달리 재사용되지 않으므로 그것이 더 강한 신원이다.
   */
  if (input.externalRepositoryId !== null) {
    const byId = await findByExternalId(
      tx,
      workspaceId,
      input.provider,
      input.externalRepositoryId,
    );

    if (byId !== null) {
      await tx.update(repositories).set(nameFields).where(eq(repositories.id, byId));
      return byId;
    }
  }

  // 2. 이름으로 찾는다 — 숫자 id 없이 만들어 둔 행을 다시 쓰기 위해서다.
  const existing = await findByFullName(
    tx,
    workspaceId,
    input.provider,
    input.fullName,
  );

  /**
   * 🔴 이름이 같아도 **이미 다른 숫자 id 가 박힌 행이면 재사용하지 않는다.**
   * 그 행은 「같은 이름을 썼던 다른 저장소」다 — 위 1번에서 이미 못 찾았기 때문이다.
   */
  const reusable =
    existing !== null &&
    (input.externalRepositoryId === null ||
      existing.externalRepositoryId.startsWith(FALLBACK_PREFIX));

  if (existing !== null && reusable) {
    await tx
      .update(repositories)
      .set({
        ...nameFields,
        // 이름으로 만들어 둔 행에 숫자 id 가 왔으면 신원을 승격한다.
        ...(input.externalRepositoryId !== null
          ? { externalRepositoryId: input.externalRepositoryId }
          : {}),
      })
      .where(eq(repositories.id, existing.id));

    return existing.id;
  }

  const externalRepositoryId =
    input.externalRepositoryId ?? fallbackExternalId(input.fullName);

  const rows = await tx
    .insert(repositories)
    .values({
      workspaceId,
      projectId,
      provider: input.provider,
      externalRepositoryId,
      ...nameFields,
    })
    .onConflictDoUpdate({
      target: [
        repositories.workspaceId,
        repositories.provider,
        repositories.externalRepositoryId,
      ],
      set: {
        /**
         * 🔴 `projectId` 를 여기서 덮어쓰지 않는다.
         *
         * Repository 를 어느 Project 에 둘지는 **사람이 정하는 일**이다. Agent 가 매
         * Review 마다 보내는 값으로 옮겨 버리면, 화면에서 옮겨 둔 것이 다음 Review 에
         * 되돌아간다. 옮기는 것은 화면의 몫으로 남긴다.
         */
        ...nameFields,
      },
    })
    .returning({ id: repositories.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new AppError("UNEXPECTED");
  }

  return id;
}

/**
 * 표기가 달라도 같은 저장소로 본다 — GitHub 의 `owner/name` 은 대소문자를 가리지 않는다.
 *
 * 🔴 이 조회는 Index 를 타지 않는다(`lower()` 표현식). Repository 수는 Workspace 당
 * 수십 단위라 실측상 문제가 아니고, 여기서 Index 를 하나 더 만드는 것은 **조회 패턴에
 * 근거하지 않은 Index** 다(CLAUDE.md 10). 저장소가 수천 개가 되면 그때 만든다.
 */
async function findByExternalId(
  tx: DbExecutor,
  workspaceId: string,
  provider: ScmProvider,
  externalRepositoryId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ id: repositories.id })
    .from(repositories)
    .where(
      and(
        eq(repositories.workspaceId, workspaceId),
        eq(repositories.provider, provider),
        eq(repositories.externalRepositoryId, externalRepositoryId),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

async function findByFullName(
  tx: DbExecutor,
  workspaceId: string,
  provider: ScmProvider,
  fullName: string,
): Promise<{ id: string; externalRepositoryId: string } | null> {
  const rows = await tx
    .select({
      id: repositories.id,
      externalRepositoryId: repositories.externalRepositoryId,
    })
    .from(repositories)
    .where(
      and(
        eq(repositories.workspaceId, workspaceId),
        eq(repositories.provider, provider),
        sql`lower(${repositories.fullName}) = lower(${fullName})`,
      ),
    )
    /**
     * 🔴 **순서를 못 박는다.** 이름은 유일하지 않다 — 지워진 저장소와 같은 이름으로
     * 새 저장소가 생기면 숫자 id 가 다른 두 행이 같은 `fullName` 을 갖는다(그것이
     * 옳다). 그때 순서 없이 하나를 집으면 **어느 행이 나올지 정해지지 않아**,
     * 숫자 id 를 모르는 요청이 지워진 저장소의 Knowledge 에 붙을 수 있다.
     *
     * 가장 최근에 손댄 행을 고른다 — 살아 있는 쪽이 계속 갱신되기 때문이다.
     * `id` 는 같은 시각일 때를 위한 마지막 기준이다.
     */
    .orderBy(desc(repositories.updatedAt), asc(repositories.id))
    .limit(1);

  return rows[0] ?? null;
}
