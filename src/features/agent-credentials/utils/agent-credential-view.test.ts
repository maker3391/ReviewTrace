import { describe, expect, it } from "vitest";

import type { AgentCredentialSummary } from "@/features/agent-credentials/server/agent-credential-service";
import {
  agentCredentialState,
  partitionAgentCredentials,
} from "@/features/agent-credentials/utils/agent-credential-view";

const NOW = new Date("2026-09-02T00:00:00.000Z");

function credential(
  overrides: Partial<AgentCredentialSummary> = {},
): AgentCredentialSummary {
  return {
    id: "credential-1",
    name: "production-mcp",
    keyPrefix: "ci_agent_ab",
    capabilityScopes: ["READ", "WRITE"],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    reviewLanguage: "ko",
    ...overrides,
  };
}

describe("agentCredentialState", () => {
  it("만료도 폐기도 없으면 쓸 수 있는 연결이다", () => {
    expect(agentCredentialState(credential(), NOW)).toBe("ACTIVE");
  });

  it("만료 시각이 지났으면 만료다", () => {
    expect(
      agentCredentialState(
        credential({ expiresAt: new Date("2026-09-01T23:59:59.000Z") }),
        NOW,
      ),
    ).toBe("EXPIRED");
  });

  /**
   * 🔴 **폐기가 만료를 이긴다.** 둘 다 해당하면 「사람이 거둬들였다」가 더 정확한 사실이다 —
   * 반대로 적으면 왜 사라졌는지가 History 에서 흐려진다.
   */
  it("만료된 뒤에 폐기했어도 폐기로 읽는다", () => {
    expect(
      agentCredentialState(
        credential({
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
          revokedAt: new Date("2026-08-20T00:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("REVOKED");
  });

  it("만료 시각이 «정확히» 지금이면 이미 못 쓴다", () => {
    expect(agentCredentialState(credential({ expiresAt: NOW }), NOW)).toBe(
      "EXPIRED",
    );
  });
});

describe("partitionAgentCredentials", () => {
  /**
   * 🔴 기본 화면은 활성 연결이 주인공이다. 폐기·만료가 같은 목록에 섞이면 실제로 쓰는
   * 연결이 묻힌다 — 그렇다고 **버리지는 않는다**. 접어서 남긴다.
   */
  it("쓸 수 있는 연결과 지나간 연결을 가르되 하나도 버리지 않는다", () => {
    const rows = [
      credential({ id: "live", name: "live" }),
      credential({
        id: "revoked",
        name: "revoked",
        revokedAt: new Date("2026-08-10T00:00:00.000Z"),
      }),
      credential({
        id: "expired",
        name: "expired",
        expiresAt: new Date("2026-08-15T00:00:00.000Z"),
      }),
    ];

    const { active, retired } = partitionAgentCredentials(rows, NOW);

    expect(active.map((row) => row.id)).toEqual(["live"]);
    expect(retired.map((row) => row.id)).toEqual(["revoked", "expired"]);
    expect(active.length + retired.length).toBe(rows.length);
    expect(retired.map((row) => row.state)).toEqual(["REVOKED", "EXPIRED"]);
  });

  it("지나간 연결이 없으면 접을 것도 없다", () => {
    const { active, retired } = partitionAgentCredentials(
      [credential()],
      NOW,
    );
    expect(active).toHaveLength(1);
    expect(retired).toHaveLength(0);
  });

  it("서버가 준 순서를 바꾸지 않는다", () => {
    const rows = [
      credential({ id: "b", name: "b" }),
      credential({ id: "a", name: "a" }),
    ];
    expect(
      partitionAgentCredentials(rows, NOW).active.map((row) => row.id),
    ).toEqual(["b", "a"]);
  });
});

