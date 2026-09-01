import type { WorkspaceRole } from "@/types/review";

/**
 * 계정을 지울 때 **Workspace 하나하나를 어떻게 할 것인가**를 정하는 자리.
 *
 * 🔴 **이 판단을 Database 질의 안에 흩지 않는다.** 같은 규칙을 「미리 보여 주는 화면」과
 * 「실제로 지우는 Transaction」 두 곳이 쓴다 — 한쪽만 고치면 **화면이 남는다고 말한
 * Workspace 를 서버가 지운다.** 그래서 규칙은 순수 함수 하나이고, 두 곳은 이 함수에
 * 사실(fact)만 넣는다.
 *
 * Database 도 `process.env` 도 보지 않는다 — 기본 `pnpm test` 에서 매번 돈다.
 *
 * # 규칙
 *
 * ```
 * 나 말고 아무도 없다 -> DELETED Workspace 째로 사라진다
 * 다른 멤버가 있는데 OWNER 가 나뿐이다 -> BLOCKED 삭제 자체를 막는다
 * 그 밖 -> PRESERVED 소속만 빠지고 Workspace 는 남는다
 * ```
 *
 * 🔴 **「Personal 이냐 Team 이냐」로 가르지 않는다.** Personal Workspace 에도 초대로
 * 사람이 들어올 수 있고(`workspace_invitations` 에 Personal 예외가 없다), 혼자 만든 Team
 * Workspace 는 사실상 개인 것이다. 갈리는 자리는 **「남는 사람이 있는가」** 하나다 —
 * 그것이 「다른 사용자가 쓰는 데이터를 계정 삭제 때문에 날리지 않는다」와 정확히 같은 질문이다.
 *
 * `personal_owner_id` 는 여기서 **오직 slug 때문에** 쓰인다(아래 `rotateSlug`).
 */

/** 이 Workspace 를 계정 삭제가 어떻게 다루는가. */
export type WorkspaceDisposition =
  /** Workspace 째로 지운다. 그 아래 Project·Review·Issue·Wiki·API Key 가 함께 사라진다. */
  | "DELETED"
  /** Workspace 는 남고 이 사람의 소속만 빠진다. */
  | "PRESERVED"
  /** 이대로는 계정을 지울 수 없다. 사람이 먼저 해결해야 한다. */
  | "BLOCKED";

/** 계획을 세우는 데 필요한 사실. 🔴 판단은 하나도 들어 있지 않다. */
export interface WorkspaceMembershipFacts {
  workspaceId: string;
  slug: string;
  name: string;
  /** 🔴 `workspaces.personal_owner_id` 가 **이 사람**을 가리키는가. */
  isPersonal: boolean;
  /** 이 사람의 역할. */
  role: WorkspaceRole;
  /** 이 사람을 뺀 멤버 수. */
  otherMembers: number;
  /** 이 사람을 뺀 OWNER 수. */
  otherOwners: number;
}

export interface WorkspaceDeletionEntry extends WorkspaceMembershipFacts {
  disposition: WorkspaceDisposition;
  /**
   * 남는 Workspace 인데 **주소가 이 사람에게서 나왔다.**
   *
   * Personal Workspace 의 slug 재료는 GitHub 아이디다(`lib/auth/config.ts`).
   * 그 사람이 나갔는데 Workspace 가 남으면 **떠난 사람의 GitHub 아이디가 팀 주소로
   * 영구히 박힌다** — 그때만 중립 slug 로 바꾼다.
   *
   * 🔴 **혼자 만든 Team Workspace 의 slug 는 바꾸지 않는다.** 그것은 사람이 고른 이름이지
   * GitHub 신원이 아니다. 주소를 바꾸는 일은 링크·북마크를 끊으므로 근거가 있을 때만 한다.
   */
  rotateSlug: boolean;
}

export interface AccountDeletionPlan {
  entries: WorkspaceDeletionEntry[];
  /** Workspace 째로 지워질 것들. */
  deleted: WorkspaceDeletionEntry[];
  /** 남는 것들. */
  preserved: WorkspaceDeletionEntry[];
  /** 사람이 먼저 해결해야 하는 것들. 하나라도 있으면 계정을 지우지 않는다. */
  blocked: WorkspaceDeletionEntry[];
  /** 지금 이 계정을 지울 수 있는가. */
  deletable: boolean;
}

function disposition(facts: WorkspaceMembershipFacts): WorkspaceDisposition {
  if (facts.otherMembers === 0) {
    return "DELETED";
  }

  /**
   * 🔴 **OWNER 가 0명인 Workspace 를 만들지 않는다.** 남은 사람들이 초대도 설정 변경도
   * API Key 발급도 영원히 못 하는 상태로 잠긴다 — 화면에 되돌릴 방법이 없다.
   * `changeMemberRole` 의 「마지막 OWNER 를 강등하지 않는다」와 **같은 불변식**이고,
   * 계정 삭제는 그 규칙을 우회하는 두 번째 문이다.
   */
  if (facts.role === "OWNER" && facts.otherOwners === 0) {
    return "BLOCKED";
  }

  return "PRESERVED";
}

export function planAccountDeletion(
  facts: WorkspaceMembershipFacts[],
): AccountDeletionPlan {
  const entries: WorkspaceDeletionEntry[] = facts.map((fact) => {
    const decided = disposition(fact);

    return {
      ...fact,
      disposition: decided,
      rotateSlug: decided === "PRESERVED" && fact.isPersonal,
    };
  });

  const blocked = entries.filter((entry) => entry.disposition === "BLOCKED");

  return {
    entries,
    deleted: entries.filter((entry) => entry.disposition === "DELETED"),
    preserved: entries.filter((entry) => entry.disposition === "PRESERVED"),
    blocked,
    deletable: blocked.length === 0,
  };
}
