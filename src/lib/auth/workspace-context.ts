import "server-only";

/**
 * 현재 요청이 접근할 수 있는 Workspace 를 결정한다.
 *
 * 🔴 **Client 가 보낸 `userId`·`workspaceId` 로 권한을 정하지 않는다**(CLAUDE.md 11).
 * 판정 근거는 둘뿐이다.
 *
 * ```
 * Web Request    Session -> User -> Workspace Membership -> Authorized Workspace
 * Agent Request  API Key -> Key Lookup -> Workspace       -> Authorized Workspace
 * ```
 *
 * 【향후 — 인증 도입 시】 이 함수 하나가 그 두 경로를 구현한다.
 * 조회·Mutation·Route Handler 는 전부 여기를 거치게 두어, 인증이 붙을 때 고칠 자리를 하나로 만든다.
 *
 * 지금은 인증이 없다. **없는 것을 있는 것처럼 흉내내지 않는다** — 임의의 Workspace 를 고르거나
 * 환경 변수로 하나 박아 두면, 그것이 그대로 다음 사람에게 「지원되는 동작」으로 읽힌다.
 */
export interface WorkspaceContext {
  workspaceId: string;
}

export async function findCurrentWorkspace(): Promise<WorkspaceContext | null> {
  return null;
}
