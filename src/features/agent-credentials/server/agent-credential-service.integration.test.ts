import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { agentPrincipals, users } from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  issueUserAgentCredential,
  listUserAgentCredentials,
} from "@/features/agent-credentials/server/agent-credential-service";

const enabled = process.env.DB_INTEGRATION === "true";
beforeAll(() => {
  if (enabled) loadIntegrationDbEnv();
});

class Rollback extends Error {}

describe.skipIf(!enabled)("Agent review language persistence", () => {
  it("stores language on the Principal so credential rotation does not fork the preference", async () => {
    await expect(
      db().transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email: `agent-language-${crypto.randomUUID()}@example.test`,
            name: "Language Owner",
          })
          .returning({ id: users.id });

        const first = await issueUserAgentCredential(
          {
            userId: user!.id,
            displayName: "Language Owner",
            name: "Codex Korean",
            expiresAt: null,
            capabilityScopes: ["READ", "WRITE"],
            reviewLanguage: "ko",
          },
          tx,
        );
        expect(first.reviewLanguage).toBe("ko");

        const rotated = await issueUserAgentCredential(
          {
            userId: user!.id,
            displayName: "Language Owner",
            name: "Codex English",
            expiresAt: null,
            capabilityScopes: ["READ", "WRITE"],
            reviewLanguage: "en",
          },
          tx,
        );
        expect(rotated.reviewLanguage).toBe("en");

        const principals = await tx
          .select({ reviewLanguage: agentPrincipals.reviewLanguage })
          .from(agentPrincipals)
          .where(eq(agentPrincipals.ownerUserId, user!.id));
        expect(principals).toEqual([{ reviewLanguage: "en" }]);
        await expect(listUserAgentCredentials(user!.id, tx)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "Codex Korean",
              reviewLanguage: "en",
            }),
            expect.objectContaining({
              name: "Codex English",
              reviewLanguage: "en",
            }),
          ]),
        );

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
