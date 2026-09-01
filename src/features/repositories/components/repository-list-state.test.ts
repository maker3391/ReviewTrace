import { describe, expect, it } from "vitest";

import { repositoryScreenState } from "@/features/repositories/components/repository-list-state";

describe("Project Repository screen state", () => {
  it("shows only the GitHub connect state before installation", () => {
    expect(
      repositoryScreenState({ hasInstallation: false, repositoryCount: 0 }),
    ).toBe("GITHUB_DISCONNECTED");
  });

  it("shows the picker state without a contradictory empty state", () => {
    expect(
      repositoryScreenState({ hasInstallation: true, repositoryCount: 0 }),
    ).toBe("READY_TO_CONNECT");
  });

  it("keeps the connected repository list primary after connection", () => {
    expect(
      repositoryScreenState({ hasInstallation: true, repositoryCount: 1 }),
    ).toBe("CONNECTED_REPOSITORIES");
    expect(
      repositoryScreenState({ hasInstallation: false, repositoryCount: 1 }),
    ).toBe("CONNECTED_REPOSITORIES");
  });
});
