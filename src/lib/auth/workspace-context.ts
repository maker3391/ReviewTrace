import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { workspaceMembers, workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/types/review";

/**
 * 「이 요청이 지금 어느 Workspace 에서, 무슨 자격으로 일하고 있는가」를 결정한다.
 *
 * 🔴 **Authentication 과 Tenant Context 는 다른 판정이다.**
 * 로그인했다고 특정 Workspace 가 영구히 정해지지 않는다 — 한 사람이 Personal Workspace 의
 * OWNER 이면서 회사 Workspace 의 MEMBER 일 수 있고, 탭마다 다른 Workspace 를 볼 수 있다.
 *
 * ```
 * Web Request Session -> User + URL slug -> WorkspaceMember -> Authorized Workspace
 * Agent Request API Key -> Key Lookup -> Workspace -> Authorized Workspace
 * ```
 *
 * 🔴 **URL 의 `workspaceSlug` 는 권한 증명이 아니다.** 주소를 남의 Workspace 로 바꿔도
 * 아래 소속 조회가 비면 아무것도 열리지 않는다. Agent 경로는 slug 를 아예 쓰지 않는다 —
 * API Key 가 Workspace 를 정한다(`src/lib/api/api-key-auth.ts`).
 */
export interface WorkspaceContext {
  workspaceId: string;
  slug: string;
  name: string;
  /** Workspace 안에서의 역할. 기능 단위 권한 판정은 이 값을 본다. */
  role: WorkspaceRole;
  /** 이 Workspace 가 그 사람의 Personal Workspace 인가. */
  isPersonal: boolean;
}

/**
 * 화면이 그리는 사용자 정보.
 *
 * 🔴 **여기 없는 것은 Client 로 넘어가지 않는다.** 세션 객체를 그대로 넘기면 RSC payload 로
 * 페이지 소스에 실려 나간다.
 */
export interface SessionUser {
  id: string;
  name: string | null;
  image: string | null;
}

/**
 * slug 로 지목된 Workspace 에 이 사용자가 실제로 속해 있는지 확인한다.
 *
 * 🔴 **소속 조회와 Workspace 조회를 한 질의로 묶는다.** 「Workspace 를 먼저 찾고 그 다음에
 * 소속을 본다」로 나누면, 소속 확인을 빠뜨린 경로가 Workspace 이름 같은 정보를 이미
 * 읽어 버린다. 여기서는 소속이 없으면 **Workspace 가 존재하는지조차 알 수 없다.**
 */
export async function findMembership(
  userId: string,
  workspaceSlug: string,
  executor: DbExecutor = db(),
): Promise<WorkspaceContext | null> {
  const rows = await executor
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
      personalOwnerId: workspaces.personalOwnerId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaces.slug, workspaceSlug),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    workspaceId: row.workspaceId,
    slug: row.slug,
    name: row.name,
    role: row.role,
    isPersonal: row.personalOwnerId === userId,
  };
}

/** Workspace Switcher 가 그리는 한 줄. 소속이 확인된 것만 들어간다. */
export interface WorkspaceSummary {
  slug: string;
  name: string;
  role: WorkspaceRole;
  isPersonal: boolean;
}

/**
 * 이 사용자가 실제 Member 인 Workspace 목록.
 *
 * 🔴 Client 가 보낸 목록을 믿지 않는다. Switcher 는 이 결과만 그린다.
 * Personal Workspace 를 맨 앞에 두고 나머지는 이름순이다 — 목록 순서가 요청마다 흔들리면
 * 사용자가 엉뚱한 곳을 누른다.
 */
export async function listMemberWorkspaces(
  userId: string,
  executor: DbExecutor = db(),
): Promise<WorkspaceSummary[]> {
  const rows = await executor
    .select({
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
      personalOwnerId: workspaces.personalOwnerId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.name);

  return rows
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      role: row.role,
      isPersonal: row.personalOwnerId === userId,
    }))
    .sort((left, right) => Number(right.isPersonal) - Number(left.isPersonal));
}
