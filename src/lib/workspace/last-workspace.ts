import "server-only";

import { cookies } from "next/headers";

/**
 * 마지막으로 보던 Workspace.
 *
 * 🔴 **Authorization 의 근거가 아니다**(스펙 16). 로그인 뒤 어디로 보낼지 정하는 **편의**일 뿐이고,
 * 읽은 뒤에는 반드시 소속을 다시 확인한다.
 *
 * Database 가 아니라 쿠키에 두는 이유:
 *
 * - **탭마다 다른 Workspace 를 볼 수 있다.** 「지금 보는 Workspace」를 사용자 행에 적으면
 *   두 탭이 서로의 값을 덮어쓴다. 그래서 이 값은 «현재 Context» 가 아니라 «마지막 흔적» 이다
 * - 화면을 열 때마다 사용자 행을 갱신하면 조회가 조회가 아니게 된다 — 쓰기가 따라붙는다
 */

/** slug 만 담는다. id 를 담으면 주소와 대조하기 위해 한 번 더 조회해야 한다. */
const LAST_WORKSPACE_COOKIE = "ci.last-workspace";

/** 로그인 세션보다 길게 기억할 이유가 없다. */
const LAST_WORKSPACE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const LAST_WORKSPACE_COOKIE_NAME = LAST_WORKSPACE_COOKIE;
export const LAST_WORKSPACE_COOKIE_MAX_AGE = LAST_WORKSPACE_MAX_AGE_SECONDS;

/**
 * 쿠키에 적힌 slug 를 읽는다.
 *
 * 🔴 쿠키 값은 **사용자가 고칠 수 있는 외부 입력**이다. 형식이 slug 가 아니면 버린다 —
 * 그대로 질의에 넣지 않는다(Drizzle 이 바인딩하므로 주입은 아니지만, 쓰레기 값으로
 * 조회를 돌릴 이유가 없다).
 */
export async function readLastWorkspaceSlug(): Promise<string | null> {
  const value = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;

  if (value === undefined || !/^[a-z0-9-]{1,40}$/.test(value)) {
    return null;
  }

  return value;
}
