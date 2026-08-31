import type { WorkspaceRole } from "@/types/review";

/**
 * 멤버 하나를 **내보낼 수 있는가**를 정하는 자리.
 *
 * 🔴 **이 판단을 Database 질의 안에 흩지 않는다.** 같은 규칙을 「버튼을 그릴지 정하는 화면」과
 * 「실제로 지우는 Transaction」 두 곳이 쓴다 — 한쪽만 고치면 **화면이 내보낼 수 있다고 말한
 * 사람을 서버가 거절하거나, 그 반대가 된다.** 그래서 규칙은 순수 함수 하나이고 두 곳은
 * 이 함수에 사실(fact)만 넣는다. `workspace-deletion-plan.ts` 와 같은 방식이다.
 *
 * Database 도 `process.env` 도 보지 않는다 — 기본 `pnpm test` 에서 매번 돈다.
 *
 * # 규칙
 *
 * ```
 * 부르는 사람이 OWNER 가 아니다   -> NOT_OWNER        서버가 거절한다
 * 대상이 나다                     -> SELF             자기 자신은 내보내지 못한다
 * 그 사람이 멤버가 아니다         -> NOT_MEMBER       내보낼 것이 없다
 * 대상이 이 Personal Workspace 의 주인 -> PERSONAL_OWNER
 * 그 밖                           -> 내보낸다
 * ```
 *
 * ## 🔴 자기 자신을 내보낼 수 없는 이유
 *
 * 그것은 「내보내기」가 아니라 **「나가기(self-leave)」**다 — 다음에 일어나는 일이 다르다.
 * 나가기는 「마지막 OWNER 가 나가면 그 Workspace 는 잠긴다」를 스스로 판정해야 하고,
 * 나간 뒤 사용자를 어디로 보낼지도 정해야 한다. 그 둘을 한 함수에 섞으면
 * **「남을 내보낸다」의 규칙이 「내가 나간다」의 사정 때문에 흔들린다.**
 *
 * 🔴 **그래서 이 함수에는 「마지막 OWNER」 판정이 없다.** 부르는 사람은 언제나 OWNER 이고
 * 자기 자신은 대상이 될 수 없으므로, 내보낸 뒤에도 **OWNER 는 최소 한 명(부른 사람)이 남는다.**
 * 없는 위험을 막는 조건을 두면 그것이 규칙인 줄 알고 다음 사람이 따라 적는다.
 *
 * ## 🔴 Personal Workspace 의 주인을 내보내지 않는 이유
 *
 * `workspaces.personal_owner_id` 는 그 Workspace 가 **그 사람의 자리**라는 사실이다.
 * 그를 소속에서 빼면 「내 Personal Workspace 인데 내가 못 들어가는」 상태가 되고,
 * 재로그인해도 되살아나지 않는다 — `personal_owner_id` 의 unique 가 새로 만드는 것을
 * 막기 때문이다(`lib/workspace/personal-workspace.ts`). 되돌릴 길이 화면에 없다.
 *
 * 🔴 **「내 Personal Workspace 인가」가 아니라 「이 Workspace 의 주인인가」를 묻는다.**
 * 남의 Personal Workspace 에 OWNER 로 올라간 사람이 주인을 쫓아내는 길도 함께 막힌다.
 */

/** 왜 내보낼 수 없는가. `null` 이 아니면 제거가 서지 않는다. */
export type MemberRemovalBlock =
  /** 부르는 사람이 OWNER 가 아니다. */
  | "NOT_OWNER"
  /** 대상이 부르는 사람 자신이다 — 그것은 「나가기」이지 「내보내기」가 아니다. */
  | "SELF"
  /** 그 사람은 이 Workspace 의 멤버가 아니다. */
  | "NOT_MEMBER"
  /** 대상이 이 Personal Workspace 의 주인이다 — 조건이 아니라 **영구히** 내보낼 수 없다. */
  | "PERSONAL_OWNER";

/** 판정에 필요한 사실. 🔴 판단은 하나도 들어 있지 않다. */
export interface MemberRemovalFacts {
  /** 부르는 사람의 이 Workspace 안 역할. */
  actorRole: WorkspaceRole;
  /** 대상이 부르는 사람 자신인가. */
  isSelf: boolean;
  /** 대상이 이 Workspace 의 멤버인가. */
  targetIsMember: boolean;
  /**
   * 대상이 `workspaces.personal_owner_id` 가 가리키는 사람인가.
   *
   * 🔴 **「부르는 사람의」 Personal Workspace 인지를 묻는 것이 아니다.**
   */
  targetIsPersonalOwner: boolean;
}

export interface MemberRemovalPlan {
  removable: boolean;
  /** 내보낼 수 있으면 `null`. */
  block: MemberRemovalBlock | null;
}

/**
 * 🔴 **막는 이유를 «하나만» 돌려준다.** 화면은 무엇이 문제인지 한 줄로 말해야 한다.
 *
 * 순서는 **자격 -> 대상이 나인가 -> 대상이 있는가 -> 영구 조건**이다.
 * 🔴 자격이 먼저인 것은 의도다 — OWNER 가 아닌 사람에게 「그 사람은 멤버가 아닙니다」로
 * 답하면, 내보낼 권한도 없는 사람이 **누가 멤버인지를 물어보는 도구**를 얻는다.
 */
export function planMemberRemoval(
  facts: MemberRemovalFacts,
): MemberRemovalPlan {
  const block = findBlock(facts);

  return { removable: block === null, block };
}

function findBlock(facts: MemberRemovalFacts): MemberRemovalBlock | null {
  if (facts.actorRole !== "OWNER") {
    return "NOT_OWNER";
  }

  if (facts.isSelf) {
    return "SELF";
  }

  if (!facts.targetIsMember) {
    return "NOT_MEMBER";
  }

  if (facts.targetIsPersonalOwner) {
    return "PERSONAL_OWNER";
  }

  return null;
}
