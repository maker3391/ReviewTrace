import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateAgent = vi.fn();
const requireAgentCapability = vi.fn();

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateAgent: (...args: unknown[]) => authenticateAgent(...args),
  requireAgentCapability: (...args: unknown[]) =>
    requireAgentCapability(...args),
}));

const { GET } = await import("@/app/api/v1/agent/context/route");

describe("GET /api/v1/agent/context", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["ko", "en"] as const)(
    "returns the authenticated Agent authoring language: %s",
    async (reviewLanguage) => {
      const authorization = {
        credentialId: "credential-id",
        reviewLanguage,
      };
      authenticateAgent.mockResolvedValue(authorization);

      const response = await GET(
        new Request("https://example.test/api/v1/agent/context"),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ reviewLanguage });
      expect(requireAgentCapability).toHaveBeenCalledWith(
        authorization,
        "READ",
      );
    },
  );
});
