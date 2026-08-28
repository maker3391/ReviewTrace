import "server-only";

import { notFound } from "next/navigation";

import { findProjectBySlug } from "@/features/projects/server/project-service";
import type { ProjectContext } from "@/features/projects/types/project";
import {
  requireWorkspace,
  type AuthorizedWorkspace,
} from "@/lib/auth/require-workspace";

/**
 * Project 화면이 그려지기 **전에** 자격을 확인하는 자리.
 *
 * ```
 * Session -> User -> Workspace 소속 확인 -> 그 Workspace 안의 Project -> Resource
 * ```
 *
 * 🔴 **순서가 곧 안전장치다**(스펙 3). Project 를 slug 로 먼저 찾은 뒤 Workspace 를 맞춰
 * 보는 구조로 만들면, 맞춰 보는 것을 빠뜨린 경로가 남의 Project 를 이미 읽어 버린다.
 * 여기서는 **소속이 확인된 `workspaceId` 로만** Project 를 찾는다 — 다른 Workspace 의
 * Project slug 를 주소에 적어도 조회 자체가 비어서 돌아온다.
 *
 * 🔴 **없으면 404 다. 403 이 아니다.** 「권한이 없습니다」로 답하면 그 slug 의 Project 가
 * 존재한다는 사실이 새어 나간다 — 주소를 훑어 남의 Project 이름을 알아낼 수 있다.
 * 없는 Project 와 남의 Project 는 밖에서 구분되지 않아야 한다.
 */
export interface AuthorizedProject extends AuthorizedWorkspace {
  project: ProjectContext;
}

export async function requireProject(
  workspaceSlug: string,
  projectSlug: string,
): Promise<AuthorizedProject> {
  const authorized = await requireWorkspace(workspaceSlug);

  const project = await findProjectBySlug(
    authorized.workspace.workspaceId,
    projectSlug,
  );

  if (project === null) {
    notFound();
  }

  return { ...authorized, project };
}
