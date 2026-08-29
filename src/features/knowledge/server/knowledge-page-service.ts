import "server-only";

import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { knowledgePages, users } from "@/db/schema";
import { isUniqueViolation } from "@/db/unique-violation";
import {
  resolveKnowledgePageInput,
  type KnowledgePageInput,
} from "@/features/knowledge/schemas/knowledge-page";
import { AppError } from "@/lib/errors";

/**
 * Wiki 문서의 Application Service(스펙 9).
 *
 * ## Scope
 *
 * ```
 * projectId = null  ->  Workspace Knowledge  (개발 공통 규칙 · Git/PR 규칙 · Security 정책)
 * projectId 있음     ->  Project Knowledge    (업무 규칙 · Architecture Decision · 장애 기록)
 * ```
 *
 * 🔴 **`workspaceId` 는 언제나 조건에 든다.** Project Knowledge 를 `projectId` 하나로만
 * 좁히면, 그 값을 잘못 얻은 경로가 곧바로 다른 Tenant 의 문서를 읽는다(CLAUDE.md 11).
 * 두 조건이 겹쳐 있으면 어느 한쪽을 틀려도 결과가 비어서 돌아온다.
 *
 * 🔴 **Workspace Scope 조회에 `projectId IS NULL` 을 반드시 붙인다.** 빠뜨리면 Workspace
 * 문서 목록에 그 아래 모든 Project 의 문서가 함께 나온다 — Tenant 유출은 아니지만
 * 「공통 규칙」과 「특정 Project 이야기」가 섞여 Knowledge 로서 못 쓰게 된다.
 */

export interface KnowledgeScope {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  /** `null` 이면 Workspace Knowledge 다. 값이 있으면 그 Workspace 안에 있음이 확인된 Project 다. */
  projectId: string | null;
}

export interface KnowledgePageListItem {
  slug: string;
  title: string;
  updatedAt: Date;
  authorName: string | null;
}

export interface KnowledgePageDetail extends KnowledgePageListItem {
  id: string;
  content: string;
  createdAt: Date;
}

/** Scope 를 SQL 조건으로 바꾼다. 이 함수를 거치지 않고 조건을 손으로 적지 않는다. */
function scopeCondition(scope: KnowledgeScope): SQL {
  const workspace = eq(knowledgePages.workspaceId, scope.workspaceId);

  const condition =
    scope.projectId === null
      ? and(workspace, isNull(knowledgePages.projectId))
      : and(workspace, eq(knowledgePages.projectId, scope.projectId));

  if (condition === undefined) {
    // `and` 는 인자가 모두 undefined 일 때만 undefined 다. 여기서는 일어나지 않는다.
    throw new AppError("INTERNAL_ERROR");
  }
  return condition;
}

export async function listKnowledgePages(
  scope: KnowledgeScope,
  executor: DbExecutor = db(),
): Promise<KnowledgePageListItem[]> {
  return executor
    .select({
      slug: knowledgePages.slug,
      title: knowledgePages.title,
      updatedAt: knowledgePages.updatedAt,
      authorName: users.name,
    })
    .from(knowledgePages)
    // 🔴 `leftJoin` 이다. 사람이 지워지면 `created_by` 가 NULL 이 되고, 그때 문서까지
    //    목록에서 사라지면 안 된다(`ON DELETE SET NULL`).
    .leftJoin(users, eq(users.id, knowledgePages.createdBy))
    .where(scopeCondition(scope))
    .orderBy(desc(knowledgePages.updatedAt));
}

export async function findKnowledgePage(
  scope: KnowledgeScope,
  slug: string,
  executor: DbExecutor = db(),
): Promise<KnowledgePageDetail | null> {
  const rows = await executor
    .select({
      id: knowledgePages.id,
      slug: knowledgePages.slug,
      title: knowledgePages.title,
      content: knowledgePages.content,
      updatedAt: knowledgePages.updatedAt,
      createdAt: knowledgePages.createdAt,
      authorName: users.name,
    })
    .from(knowledgePages)
    .leftJoin(users, eq(users.id, knowledgePages.createdBy))
    .where(and(scopeCondition(scope), eq(knowledgePages.slug, slug)))
    .limit(1);

  return rows[0] ?? null;
}

export interface SaveKnowledgePageCommand {
  scope: KnowledgeScope;
  createdBy: string;
  input: KnowledgePageInput;
}

/**
 * 새 문서를 만든다.
 *
 * 🔴 **같은 slug 를 두 번 만들지 못하게 하는 것은 부분 unique index 다**
 * (`knowledge_pages_workspace_slug_unique` · `knowledge_pages_project_slug_unique`).
 * 「있는지 보고 없으면 만든다」로는 두 요청이 동시에 통과하는 틈이 막히지 않는다.
 *
 * @throws {AppError} slug 가 이미 쓰이면 `CONFLICT`.
 */
export async function createKnowledgePage(
  command: SaveKnowledgePageCommand,
  executor: DbExecutor = db(),
): Promise<string> {
  const resolved = resolveKnowledgePageInput(command.input);
  if (!resolved.ok) {
    throw new AppError("VALIDATION_ERROR", resolved.reason);
  }

  /**
   * 🔴 `onConflictDoNothing` 에 target 을 적지 않는다.
   *
   * 이 표의 unique 는 **부분 index 두 개**라 Scope 마다 걸리는 것이 다르다. target 을
   * 하나로 적으면 다른 Scope 에서 걸린 충돌을 잡지 못해 예외가 밖으로 나간다.
   * target 없는 형태는 「어느 제약이든 걸리면 넘어간다」다.
   */
  const created = await executor
    .insert(knowledgePages)
    .values({
      workspaceId: command.scope.workspaceId,
      projectId: command.scope.projectId,
      title: resolved.value.title,
      slug: resolved.value.slug,
      content: resolved.value.content,
      createdBy: command.createdBy,
    })
    .onConflictDoNothing()
    .returning({ slug: knowledgePages.slug });

  const slug = created[0]?.slug;
  if (slug === undefined) {
    throw new AppError("CONFLICT", "같은 slug 의 문서가 이미 있습니다.");
  }

  return slug;
}

/**
 * 문서를 고친다.
 *
 * slug 도 바꿀 수 있다 — 다만 **Scope 안에서 여전히 유일해야** 한다. 겹치면 저장하지 않는다.
 *
 * @throws {AppError} 대상이 없으면 `NOT_FOUND`, slug 가 겹치면 `CONFLICT`.
 */
export async function updateKnowledgePage(
  command: SaveKnowledgePageCommand & { currentSlug: string },
  executor: DbExecutor = db(),
): Promise<string> {
  const resolved = resolveKnowledgePageInput(command.input);
  if (!resolved.ok) {
    throw new AppError("VALIDATION_ERROR", resolved.reason);
  }

  const updated = await executor
    .update(knowledgePages)
    .set({
      title: resolved.value.title,
      slug: resolved.value.slug,
      content: resolved.value.content,
      updatedAt: new Date(),
    })
    .where(
      and(
        scopeCondition(command.scope),
        eq(knowledgePages.slug, command.currentSlug),
      ),
    )
    .returning({ slug: knowledgePages.slug })
    .catch((cause: unknown) => {
      /**
       * unique 위반은 **사용자 입력 문제**다 — 500 이 아니라 `CONFLICT` 다.
       * 🔴 Driver 오류 message 에는 쿼리와 값이 실려 온다. 밖으로 흘리지 않는다(CLAUDE.md 19).
       *
       * 🔴 **unique 위반«일 때만» 바꾼다.** 무엇이 오든 `CONFLICT` 로 접으면 접속 끊김·
       * timeout 까지 「같은 slug 가 있습니다」가 되어, 사용자는 멀쩡한 이름을 바꿔 가며
       * 계속 실패하고 진짜 원인은 어디에도 남지 않는다(`src/db/unique-violation.ts`).
       */
      if (isUniqueViolation(cause)) {
        throw new AppError("CONFLICT", "같은 slug 의 문서가 이미 있습니다.", {
          cause,
        });
      }
      throw cause;
    });

  const slug = updated[0]?.slug;
  if (slug === undefined) {
    throw new AppError("NOT_FOUND", "문서를 찾을 수 없습니다.");
  }

  return slug;
}

/**
 * 문서를 지운다.
 *
 * 🔴 `workspaceId`(와 Project Scope)를 조건에 함께 건다. slug 를 안다는 것이 권한이 되지
 * 않게 한다.
 *
 * @throws {AppError} 대상이 없으면 `NOT_FOUND`.
 */
export async function deleteKnowledgePage(
  scope: KnowledgeScope,
  slug: string,
  executor: DbExecutor = db(),
): Promise<void> {
  const deleted = await executor
    .delete(knowledgePages)
    .where(and(scopeCondition(scope), eq(knowledgePages.slug, slug)))
    .returning({ id: knowledgePages.id });

  if (deleted.length === 0) {
    throw new AppError("NOT_FOUND", "문서를 찾을 수 없습니다.");
  }
}

/**
 * Agent 가 읽어 가는 Wiki 조각(스펙 10).
 *
 * 🔴 **본문을 통째로 주지 않는다.** Knowledge Context 는 「무엇이 있는가」를 알리는 자리고,
 * 전문이 필요하면 그 문서를 따로 읽는다 — 한 응답이 Workspace 의 모든 규칙 원문을 실어
 * 나르면 Agent 의 Context 를 그것만으로 채운다.
 */
export interface KnowledgeExcerpt {
  slug: string;
  title: string;
  scope: "WORKSPACE" | "PROJECT";
  excerpt: string;
  updatedAt: Date;
}

/** 발췌 길이. 무엇을 다루는 문서인지 알아볼 정도. */
const EXCERPT_LENGTH = 500;

export async function listKnowledgeExcerpts(
  input: { workspaceId: string; projectId: string | null; limit: number },
  executor: DbExecutor = db(),
): Promise<KnowledgeExcerpt[]> {
  /**
   * Project 를 지정하면 **Workspace 공통 규칙과 그 Project 의 문서를 함께** 준다.
   * Agent 는 둘 다 지켜야 한다 — 공통 규칙을 빼고 주면 그것을 모르는 채로 작업한다.
   */
  const scope =
    input.projectId === null
      ? and(
          eq(knowledgePages.workspaceId, input.workspaceId),
          isNull(knowledgePages.projectId),
        )
      : and(
          eq(knowledgePages.workspaceId, input.workspaceId),
          sql`(${knowledgePages.projectId} is null or ${knowledgePages.projectId} = ${input.projectId})`,
        );

  const rows = await executor
    .select({
      slug: knowledgePages.slug,
      title: knowledgePages.title,
      projectId: knowledgePages.projectId,
      excerpt: sql<string>`left(${knowledgePages.content}, ${EXCERPT_LENGTH})`,
      updatedAt: knowledgePages.updatedAt,
    })
    .from(knowledgePages)
    .where(scope)
    .orderBy(desc(knowledgePages.updatedAt))
    .limit(input.limit);

  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    scope: row.projectId === null ? ("WORKSPACE" as const) : ("PROJECT" as const),
    excerpt: row.excerpt,
    updatedAt: row.updatedAt,
  }));
}
