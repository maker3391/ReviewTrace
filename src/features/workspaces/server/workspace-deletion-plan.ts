import type { WorkspaceRole } from "@/types/review";

/**
 * Workspace 하나를 **지울 수 있는가**를 정하는 자리.
 *
 * 🔴 **이 판단을 Database 질의 안에 흩지 않는다.** 같은 규칙을 「미리 보여 주는 화면」과
 * 「실제로 지우는 Transaction」 두 곳이 쓴다 — 한쪽만 고치면 **화면이 지울 수 있다고 말한
 * Workspace 를 서버가 거절하거나, 그 반대가 된다.** 그래서 규칙은 순수 함수 하나이고,
 * 두 곳은 이 함수에 사실(fact)만 넣는다.
 * `account-deletion-plan.ts` 와 같은 방식이다.
 *
 * Database 도 `process.env` 도 보지 않는다 — 기본 `pnpm test` 에서 매번 돈다.
 *
 * # 규칙
 *
 * ```
 * OWNER 가 아니다 -> NOT_OWNER 서버가 거절한다
 * Personal Workspace 다 -> PERSONAL 영원히 지울 수 없다
 * 나 말고 멤버가 «한 명이라도» -> HAS_MEMBERS 먼저 내보내야 한다
 * 그 밖 -> 지운다
 * ```
 *
 * ## 🔴 Personal Workspace 를 지우지 않는 이유
 *
 * 그것은 가입이 만들어 준 **그 사람의 자리**다. 지우게 두면 소속이 하나도
 * 없는 사용자가 생기고, 그 사람이 로그인하면 갈 곳이 없다. 🔴 **그때 Personal Workspace 를
 * 다시 만들어 주는 길로 메우지 않는다** — 그러면 「지웠는데 되살아나는」 동작이 되고,
 * `workspaces.personal_owner_id` 의 unique 로 한 개만 두려던 설계가 흔들린다.
 * 지울 수 없게 하는 쪽이 규칙이 하나 적다.
 *
 * 🔴 **「내 Personal Workspace 인가」가 아니라 「Personal Workspace 인가」를 묻는다.**
 * `personal_owner_id` 가 누구를 가리키든 그 Workspace 는 누군가의 자리다.
 *
 * ## 🔴 멤버를 함께 지우지 않는 이유
 *
 * Workspace 를 지우면 그 안의 Review Knowledge 가 **전부** 사라진다. 다른 사람이 아직
 * 쓰고 있는데 OWNER 한 명의 결정으로 날리지 않는다 — 계정 삭제가 「다른 멤버가 있으면
 * Workspace 를 보존한다」로 판단하는 것과 **같은 이유**다(`account-deletion-plan.ts`).
 * 내보내는 일은 사람이 먼저 한다.
 */

/** 왜 지울 수 없는가. `null` 이 아니면 삭제가 서지 않는다. */
export type WorkspaceDeletionBlock =
  /** 부르는 사람이 OWNER 가 아니다. */
  | "NOT_OWNER"
  /** Personal Workspace 다 — 조건이 아니라 **영구히** 지울 수 없다. */
  | "PERSONAL"
  /** 나 말고 멤버가 남아 있다. 먼저 내보내야 한다. */
  | "HAS_MEMBERS";

/** 판정에 필요한 사실. 🔴 판단은 하나도 들어 있지 않다. */
export interface WorkspaceDeletionFacts {
  /**
   * `workspaces.personal_owner_id` 가 채워져 있는가.
   *
   * 🔴 **「그 값이 나인가」가 아니다.** 남의 Personal Workspace 도 Personal Workspace 다.
   */
  isPersonal: boolean;
  /** 부르는 사람의 이 Workspace 안 역할. */
  role: WorkspaceRole;
  /** 부르는 사람을 뺀 멤버 수. */
  otherMembers: number;
}

export interface WorkspaceDeletionPlan {
  deletable: boolean;
  /** 지울 수 있으면 `null`. */
  block: WorkspaceDeletionBlock | null;
}

/**
 * 🔴 **막는 이유를 «하나만» 돌려준다.** 화면은 무엇을 먼저 해야 하는지 한 줄로 말해야 하고,
 * 이유를 늘어놓으면 사람이 순서를 스스로 짜야 한다.
 *
 * 순서는 **자격 -> 영구 조건 -> 사람이 풀 수 있는 조건**이다. OWNER 가 아닌 사람에게
 * 「멤버를 내보내세요」라고 말하면 그가 할 수 없는 일을 시키는 것이 된다.
 */
export function planWorkspaceDeletion(
  facts: WorkspaceDeletionFacts,
): WorkspaceDeletionPlan {
  const block = findBlock(facts);

  return { deletable: block === null, block };
}

function findBlock(
  facts: WorkspaceDeletionFacts,
): WorkspaceDeletionBlock | null {
  if (facts.role !== "OWNER") {
    return "NOT_OWNER";
  }

  if (facts.isPersonal) {
    return "PERSONAL";
  }

  if (facts.otherMembers > 0) {
    return "HAS_MEMBERS";
  }

  return null;
}
