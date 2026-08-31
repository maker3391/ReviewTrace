/**
 * 조회의 «범위».
 *
 * 🔴 **여기 담긴 값은 이미 인증을 통과한 것이다.** Client 가 보낸 `workspaceId`·`projectId` 를
 * 그대로 넣지 않는다 — 이 타입을 만드는 자리는 `requireWorkspace`·`requireProject` 뿐이다
 *.
 *
 * ## 왜 타입 하나를 공유하는가
 *
 * Feature 마다 같은 두 칸짜리 interface 를 다시 적으면, 나중에 범위가 하나 늘어날 때
 * 고칠 자리가 흩어진다. 그렇다고 조회 «함수»를 공유하면 Feature 끼리 묶인다.
 *
 * **타입만 공유하고 질의는 각자 갖는다** — 이 파일은 순수 타입이라 import 해도 아무것도
 * 끌고 오지 않는다. Feature 를 통째로 들어내도 이 파일은 영향을 주고받지 않는다.
 */

/** Workspace 하나로 좁힌 범위. */
export interface WorkspaceScope {
 workspaceId: string;
}

/**
 * Workspace 안의 Project 하나로 좁힌 범위.
 *
 * 🔴 **`workspaceId` 를 함께 들고 다니는 것이 요점이다.** `projectId` 하나로만 좁히면
 * 그 값을 잘못 얻은 경로가 곧바로 다른 Tenant 를 읽는다 — 조건을 겹쳐 두면 어느 한쪽을
 * 틀려도 결과가 비어서 돌아온다.
 */
export interface ProjectScope extends WorkspaceScope {
 projectId: string;
}
