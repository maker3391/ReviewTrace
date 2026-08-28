import "server-only";

import { notFound, redirect } from "next/navigation";

import { LOGIN_PATH } from "@/config/routes";
import {
  currentUser,
  findMembership,
  type SessionUser,
  type WorkspaceContext,
} from "@/lib/auth/workspace-context";

/**
 * 화면이 그려지기 **전에** 자격을 확인하는 자리.
 *
 * 🔴 클라이언트 판정을 「추가」하는 것으로 대신하지 않는다 — 렌더가 시작되면 보호된 화면의
 * 뼈대가 한 번 보인다(CLAUDE.md 11).
 */

/** 로그인만 확인한다. Workspace 를 아직 고르지 않은 화면(랜딩·초대 수락)이 쓴다. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();

  if (user === null) {
    redirect(LOGIN_PATH);
  }

  return user;
}

export interface AuthorizedWorkspace {
  user: SessionUser;
  workspace: WorkspaceContext;
}

/**
 * URL 의 slug 가 가리키는 Workspace 에 **실제로 속해 있을 때만** 통과시킨다.
 *
 * 🔴 소속이 없으면 **404 다.** 「권한이 없습니다(403)」로 답하면 그 slug 의 Workspace 가
 * 존재한다는 사실을 알려 주는 셈이 된다 — 주소를 훑어 남의 Workspace 이름을 알아낼 수 있다.
 * 없는 Workspace 와 남의 Workspace 는 밖에서 구분되지 않아야 한다.
 */
export async function requireWorkspace(
  workspaceSlug: string,
): Promise<AuthorizedWorkspace> {
  const user = await requireUser();
  const workspace = await findMembership(user.id, workspaceSlug);

  if (workspace === null) {
    notFound();
  }

  return { user, workspace };
}

/**
 * OWNER 만 할 수 있는 일(초대 발행 등)의 경계.
 *
 * 화면에서 버튼을 감추는 것은 편의일 뿐이다. 서버가 같은 판정을 반드시 다시 한다.
 */
export function requireOwner(workspace: WorkspaceContext): void {
  if (workspace.role !== "OWNER") {
    notFound();
  }
}
