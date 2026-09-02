import type { AgentCredentialSummary } from "@/features/agent-credentials/server/agent-credential-service";

/**
 * 화면이 Agent 연결을 어떻게 나누어 보여줄지 정하는 «순수» 규칙.
 *
 * 🔴 **Component 안의 임의 `if` 로 흩뿌리지 않는다.** 「무엇이 아직 쓸 수 있는 연결인가」는
 * 목록 정렬·접기·개수 표시 세 곳이 함께 쓰는 판단이라, 한 곳에서 정해 두지 않으면
 * 「목록에는 있는데 개수에는 없는」 상태가 생긴다.
 *
 * 🔴 **security semantics 를 여기서 바꾸지 않는다.** 실제 인증은 서버(`api-key-auth.ts`)가
 * 만료·폐기를 다시 판정한다 — 이것은 그 판정을 «보여 주기 위한» 거울일 뿐이다.
 */
export type AgentCredentialState = "ACTIVE" | "EXPIRED" | "REVOKED";

export interface AgentCredentialView extends AgentCredentialSummary {
  state: AgentCredentialState;
}

export function agentCredentialState(
  credential: Pick<AgentCredentialSummary, "revokedAt" | "expiresAt">,
  now: Date,
): AgentCredentialState {
  /**
   * 🔴 **폐기가 만료를 이긴다.** 만료된 뒤에 폐기한 것도 「사람이 거둬들였다」가 더 정확한
   * 사실이다 — 반대로 적으면 왜 사라졌는지가 History 에서 흐려진다.
   */
  if (credential.revokedAt !== null) return "REVOKED";
  if (
    credential.expiresAt !== null &&
    credential.expiresAt.getTime() <= now.getTime()
  ) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

/**
 * 쓸 수 있는 연결과 지나간 연결을 가른다.
 *
 * 🔴 **지나간 것을 «지우지» 않는다.** 폐기·만료 이력은 「이 Agent 가 언제까지 무엇을
 * 했는가」의 근거라 DB 에서도 화면에서도 남는다 — 다만 기본 화면에서 활성 연결을
 * 덮지 않도록 접어 둔다.
 */
export function partitionAgentCredentials(
  credentials: readonly AgentCredentialSummary[],
  now: Date,
): { active: AgentCredentialView[]; retired: AgentCredentialView[] } {
  const active: AgentCredentialView[] = [];
  const retired: AgentCredentialView[] = [];
  for (const credential of credentials) {
    const view = { ...credential, state: agentCredentialState(credential, now) };
    (view.state === "ACTIVE" ? active : retired).push(view);
  }
  return { active, retired };
}
