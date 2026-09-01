import { expect, it } from "vitest";

import { fakeExecutor, selects } from "@/db/testing/fake-executor";
import { findKnowledgeContext } from "@/features/knowledge/server/knowledge-context-query";

it("unknown Repository를 Workspace-wide Knowledge로 확대하지 않는다", async () => {
  const fake = fakeExecutor([selects([])]);
  const context = await findKnowledgeContext(
    {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      query: {
        projectSlug: null,
        repository: "acme/unknown",
        repositoryId: null,
        category: null,
        pattern: null,
        severity: null,
        limit: 20,
      },
    },
    fake.executor,
  );
  expect(context.scope.repository).toEqual({
    requested: "acme/unknown",
    resolved: false,
    id: null,
    fullName: null,
  });
  expect(context.scope.project).toMatchObject({
    resolved: false,
    resolutionSource: null,
  });
  expect(context.wiki).toEqual([]);
  expect(fake.calls).toHaveLength(1);
});
