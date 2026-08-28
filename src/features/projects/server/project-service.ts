import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  knowledgePages,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
} from "@/db/schema";
import {
  resolveProjectInput,
  type CreateProjectInput,
} from "@/features/projects/schemas/project";
import type {
  ProjectContext,
  ProjectSummary,
} from "@/features/projects/types/project";
import { AppError } from "@/lib/errors";
import { normalizeSlug } from "@/lib/workspace/slug";

/**
 * Project 의 Application Service.
 *
 * 🔴 **모든 함수의 첫 조건이 `workspaceId` 다.** 그 값은 호출자가 소속 확인으로 얻은 것이고
 * (`require-workspace.ts`), Client 가 보낸 값이 아니다(CLAUDE.md 11).
 * `projectId`·`projectSlug` 만으로 조회하는 경로를 **만들지 않는다** — 그것을 만드는 순간
 * ID 를 아는 것이 곧 권한이 된다.
 */

/** 미해결로 보는 상태. `IGNORED`·`FALSE_POSITIVE` 는 「더 보지 않기로 한 것」이라 뺀다. */
const OPEN_STATUSES = sql`('OPEN', 'IN_PROGRESS', 'REOPENED')`;

/** slug 가 겹칠 때 다음 후보를 시도하는 횟수. Workspace slug 와 같은 방식이다. */
const MAX_SLUG_ATTEMPTS = 5;

/**
 * 소속이 확인된 Workspace 안에서 Project 하나를 찾는다.
 *
 * 🔴 조건이 둘이다. slug 만으로 찾지 않는다 — 그러면 남의 Workspace 의 Project 가 나온다.
 */
export async function findProjectBySlug(
  workspaceId: string,
  projectSlug: string,
  executor: DbExecutor = db(),
): Promise<ProjectContext | null> {
  const rows = await executor
    .select({
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
    })
    .from(projects)
    .where(
      and(eq(projects.workspaceId, workspaceId), eq(projects.slug, projectSlug)),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * 사이드바가 그리는 최소 목록. 집계 없이 이름만 필요할 때 쓴다.
 *
 * 🔴 목록 화면과 나눈 이유가 있다 — 사이드바는 **모든 화면에서** 돈다. 거기에 Review·Issue
 * 집계를 얹으면 Project 를 열지 않는 화면에서도 매번 Join 세 개가 붙는다.
 */
export async function listProjectOptions(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<ProjectContext[]> {
  return executor
    .select({
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
    })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(asc(projects.name));
}

/**
 * Projects 화면과 Workspace Dashboard 가 쓰는 목록 — 상태까지 함께.
 *
 * 🔴 **Project 마다 다시 세지 않는다**(스펙 12). Project 목록을 먼저 읽고 그 수만큼 COUNT 를
 * 던지면 Project 가 늘 때마다 Round Trip 이 늘어난다(N+1). 여기서는 **문장 하나**다 —
 * Repository·ReviewSession·ReviewIssue 를 각각 Project 단위로 접어 둔 뒤 붙인다.
 *
 * Subquery 로 접는 이유는 **Join 을 곧장 겹치면 행이 곱해지기** 때문이다. Repository 3개에
 * Review 10건이면 30행이 되고, 그 위에서 센 Repository 수는 30이 된다.
 */
export async function listProjectSummaries(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<ProjectSummary[]> {
  const repositoryStats = executor
    .select({
      projectId: repositories.projectId,
      repositoryCount: sql<number>`count(*)::int`.as("repository_count"),
    })
    .from(repositories)
    .where(eq(repositories.workspaceId, workspaceId))
    .groupBy(repositories.projectId)
    .as("repository_stats");

  const reviewStats = executor
    .select({
      projectId: repositories.projectId,
      reviewCount: sql<number>`count(*)::int`.as("review_count"),
      lastReviewAt: sql<Date | null>`max(${reviewSessions.createdAt})`.as(
        "last_review_at",
      ),
    })
    .from(reviewSessions)
    .innerJoin(repositories, eq(repositories.id, reviewSessions.repositoryId))
    .where(eq(reviewSessions.workspaceId, workspaceId))
    .groupBy(repositories.projectId)
    .as("review_stats");

  const issueStats = executor
    .select({
      projectId: repositories.projectId,
      openIssueCount:
        sql<number>`count(*) filter (where ${reviewIssues.status} in ${OPEN_STATUSES})::int`.as(
          "open_issue_count",
        ),
      lastIssueAt: sql<Date | null>`max(${reviewIssues.updatedAt})`.as(
        "last_issue_at",
      ),
    })
    .from(reviewIssues)
    .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
    .where(eq(reviewIssues.workspaceId, workspaceId))
    .groupBy(repositories.projectId)
    .as("issue_stats");

  const rows = await executor
    .select({
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
      repositoryCount: sql<number>`coalesce(${repositoryStats.repositoryCount}, 0)`,
      reviewCount: sql<number>`coalesce(${reviewStats.reviewCount}, 0)`,
      openIssueCount: sql<number>`coalesce(${issueStats.openIssueCount}, 0)`,
      // 「마지막 활동」은 Review 와 Issue 중 더 최근인 쪽이다. 둘 다 없으면 NULL 이다.
      lastActivityAt: sql<
        Date | null
      >`greatest(${reviewStats.lastReviewAt}, ${issueStats.lastIssueAt})`,
    })
    .from(projects)
    .leftJoin(repositoryStats, eq(repositoryStats.projectId, projects.id))
    .leftJoin(reviewStats, eq(reviewStats.projectId, projects.id))
    .leftJoin(issueStats, eq(issueStats.projectId, projects.id))
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(asc(projects.name));

  return rows;
}

export interface CreateProjectCommand {
  /** 🔴 소속 확인을 통과한 값. Client 가 보낸 `workspaceId` 를 쓰지 않는다. */
  workspaceId: string;
  createdBy: string;
  input: CreateProjectInput;
}

/**
 * Project 를 만든다.
 *
 * 🔴 **같은 slug 를 두 번 만들지 못하게 하는 것은 `UNIQUE(workspace_id, slug)` 다.**
 * 「있는지 보고 없으면 만든다」로는 두 요청이 동시에 통과하는 틈이 막히지 않는다 —
 * 여기서는 넣어 보고 걸리면 다음 후보로 간다.
 *
 * 사용자가 slug 를 **직접 적었으면** 후보를 바꾸지 않는다. 적은 것과 다른 주소가 만들어지면
 * 그것대로 놀란다. 이름에서 유도한 경우에만 `-2`·`-3` 을 붙인다.
 *
 * @throws {AppError} slug 가 이미 쓰이면 `CONFLICT`.
 */
export async function createProject(
  command: CreateProjectCommand,
  executor: DbExecutor = db(),
): Promise<ProjectContext> {
  const resolved = resolveProjectInput(command.input);
  if (!resolved.ok) {
    throw new AppError("VALIDATION_ERROR", resolved.reason);
  }

  const explicitSlug = command.input.slug.trim() !== "";
  const attempts = explicitSlug ? 1 : MAX_SLUG_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const slug =
      attempt === 0
        ? resolved.value.slug
        : normalizeSlug(`${resolved.value.slug}-${attempt + 1}`);

    const created = await executor
      .insert(projects)
      .values({
        workspaceId: command.workspaceId,
        name: resolved.value.name,
        slug,
        description: resolved.value.description,
        createdBy: command.createdBy,
      })
      .onConflictDoNothing({ target: [projects.workspaceId, projects.slug] })
      .returning({
        projectId: projects.id,
        slug: projects.slug,
        name: projects.name,
        description: projects.description,
      });

    const project = created[0];
    if (project !== undefined) {
      return project;
    }
  }

  throw new AppError(
    "CONFLICT",
    explicitSlug
      ? "같은 slug 의 Project 가 이미 있습니다."
      : "같은 이름의 Project 가 이미 있습니다. slug 를 직접 정해 주세요.",
  );
}

/**
 * Agent 요청이 가리키는 Project 를 확보한다(스펙 10 · 15).
 *
 * ```
 * API Key -> Workspace -> payload.project?.slug -> Project (없으면 만든다)
 *                      -> 없으면              -> 'default' Project (없으면 만든다)
 * ```
 *
 * 🔴 **Client 가 Workspace 를 지정하지 못한다**(CLAUDE.md 13). `workspaceId` 는 API Key 가
 * 정한 값이고, Payload 가 고를 수 있는 것은 **그 Workspace 안의 Project** 뿐이다. 남의
 * Workspace 의 Project slug 를 적어도 아래 조회가 `workspaceId` 로 좁혀 아무것도 찾지 못하고,
 * 그 slug 로 **이 Workspace 안에** 새 Project 가 하나 생길 뿐이다.
 *
 * ## 왜 `default` 를 자동으로 만드는가
 *
 * Repository 를 Agent 가 처음 보낼 때 자동으로 만드는 것과 같은 이유다 — Agent 는 화면이
 * 없다. Project 를 미리 만들어 두지 않으면 첫 Review 가 통째로 거절되고, 그 Agent 는
 * 「무엇을 먼저 만들어야 하는지」를 알 방법이 없다.
 *
 * 🔴 이것은 **Migration 의 Default Project 와 다른 이야기다.** 저쪽은 이미 있는 데이터를
 * 옮기는 일이라 실제 데이터를 확인하고 결정했고(0행이라 하나도 만들지 않았다), 이쪽은
 * 앞으로 들어오는 요청을 받는 일이다.
 */
export const INGEST_DEFAULT_PROJECT_SLUG = "default";

export interface IngestProjectRef {
  slug: string;
  name: string | null;
}

export async function resolveIngestProject(
  input: { workspaceId: string; project: IngestProjectRef | null },
  executor: DbExecutor = db(),
): Promise<string> {
  const slug = normalizeSlug(input.project?.slug ?? INGEST_DEFAULT_PROJECT_SLUG);
  const name =
    input.project?.name ??
    (slug === INGEST_DEFAULT_PROJECT_SLUG ? "Default" : slug);

  const existing = await findProjectBySlug(input.workspaceId, slug, executor);
  if (existing !== null) {
    return existing.projectId;
  }

  /**
   * 🔴 `onConflictDoNothing` 이다 — 같은 Workspace 로 두 Agent 요청이 동시에 닿으면 진 쪽은
   * 예외로 Transaction 을 깨는 대신 「이미 있다」로 받아 아래에서 다시 읽는다.
   * 이 함수는 Review 저장 Transaction **안에서** 도므로, 여기서 던지면 Review 전체가 날아간다.
   */
  const created = await executor
    .insert(projects)
    .values({ workspaceId: input.workspaceId, name, slug })
    .onConflictDoNothing({ target: [projects.workspaceId, projects.slug] })
    .returning({ id: projects.id });

  const createdId = created[0]?.id;
  if (createdId !== undefined) {
    return createdId;
  }

  const raced = await findProjectBySlug(input.workspaceId, slug, executor);
  if (raced === null) {
    throw new AppError("INTERNAL_ERROR");
  }
  return raced.projectId;
}

/**
 * Project 이름·slug·설명을 고친다.
 *
 * 🔴 `workspaceId` 를 조건에 함께 건다. Project ID 를 안다는 것이 권한이 되지 않게 한다.
 *
 * @throws {AppError} 대상이 없으면 `NOT_FOUND`, slug 가 겹치면 `CONFLICT`.
 */
export async function updateProject(
  command: {
    workspaceId: string;
    projectId: string;
    input: CreateProjectInput;
  },
  executor: DbExecutor = db(),
): Promise<ProjectContext> {
  const resolved = resolveProjectInput(command.input);
  if (!resolved.ok) {
    throw new AppError("VALIDATION_ERROR", resolved.reason);
  }

  const updated = await executor
    .update(projects)
    .set({
      name: resolved.value.name,
      slug: resolved.value.slug,
      description: resolved.value.description,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projects.id, command.projectId),
        eq(projects.workspaceId, command.workspaceId),
      ),
    )
    .returning({
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
    })
    .catch((cause: unknown) => {
      /**
       * unique 위반은 **사용자 입력 문제**다 — 500 이 아니라 `CONFLICT` 다.
       * 🔴 Driver 오류 message 에는 쿼리와 값이 실려 온다. 밖으로 흘리지 않는다(CLAUDE.md 19).
       */
      throw new AppError("CONFLICT", "같은 slug 의 Project 가 이미 있습니다.", {
        cause,
      });
    });

  const project = updated[0];
  if (project === undefined) {
    throw new AppError("NOT_FOUND", "Project 를 찾을 수 없습니다.");
  }

  return project;
}

/** 지우면 함께 사라지는 것. 🔴 사용자에게 «무엇을 잃는지» 먼저 보여 주기 위한 값이다. */
export interface ProjectDeletionImpact {
  repositories: number;
  reviewSessions: number;
  reviewIssues: number;
  knowledgePages: number;
}

export async function findProjectDeletionImpact(
  input: { workspaceId: string; projectId: string },
  executor: DbExecutor = db(),
): Promise<ProjectDeletionImpact> {
  const scope = and(
    eq(repositories.workspaceId, input.workspaceId),
    eq(repositories.projectId, input.projectId),
  );

  const [repositoryRows, sessionRows, issueRows, pageRows] = await Promise.all([
    executor
      .select({ value: sql<number>`count(*)::int` })
      .from(repositories)
      .where(scope),
    executor
      .select({ value: sql<number>`count(*)::int` })
      .from(reviewSessions)
      .innerJoin(repositories, eq(repositories.id, reviewSessions.repositoryId))
      .where(scope),
    executor
      .select({ value: sql<number>`count(*)::int` })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(scope),
    executor
      .select({ value: sql<number>`count(*)::int` })
      .from(knowledgePages)
      .where(
        and(
          eq(knowledgePages.workspaceId, input.workspaceId),
          eq(knowledgePages.projectId, input.projectId),
        ),
      ),
  ]);

  return {
    repositories: repositoryRows[0]?.value ?? 0,
    reviewSessions: sessionRows[0]?.value ?? 0,
    reviewIssues: issueRows[0]?.value ?? 0,
    knowledgePages: pageRows[0]?.value ?? 0,
  };
}

/**
 * Project 를 지운다.
 *
 * 🔴 **되돌릴 수 없다.** FK 가 전부 `ON DELETE CASCADE` 라 그 아래 Repository ·
 * ReviewSession · ReviewIssue · IssueActivity · Project Knowledge 가 **함께 사라진다.**
 * 부르는 쪽은 `findProjectDeletionImpact` 로 무엇을 잃는지 먼저 보여 준다.
 *
 * Repository 를 살리고 싶으면 지우기 전에 다른 Project 로 옮긴다
 * (`moveRepositoryToProject`).
 *
 * @throws {AppError} 대상이 없으면 `NOT_FOUND`.
 */
export async function deleteProject(
  input: { workspaceId: string; projectId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  const deleted = await executor
    .delete(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: projects.id });

  if (deleted.length === 0) {
    throw new AppError("NOT_FOUND", "Project 를 찾을 수 없습니다.");
  }
}
