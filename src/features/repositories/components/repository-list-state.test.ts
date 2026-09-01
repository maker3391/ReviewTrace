import { describe, expect, it } from "vitest";

import {
  excludeCurrentProjectRepositories,
  repositoryScreenState,
} from "@/features/repositories/components/repository-list-state";

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

describe("Project Repository picker candidates", () => {
  it("excludes only repositories already connected to the current Project", () => {
    const repositories = [
      { externalRepositoryId: "repo-a", fullName: "acme/a" },
      { externalRepositoryId: "repo-b", fullName: "acme/b" },
    ];

    expect(
      excludeCurrentProjectRepositories(repositories, [
        { externalRepositoryId: "repo-a", fullName: "acme/a" },
      ]),
    ).toEqual([{ externalRepositoryId: "repo-b", fullName: "acme/b" }]);
  });

  it("excludes a legacy fullname-only row after GitHub resolves its numeric id", () => {
    expect(
      excludeCurrentProjectRepositories(
        [
          {
            externalRepositoryId: "1349133928",
            fullName: "maker3391/ReviewTrace",
          },
        ],
        [
          {
            externalRepositoryId: "fullname:maker3391/reviewtrace",
            fullName: "Maker3391/reviewtrace",
          },
        ],
      ),
    ).toEqual([]);
  });
});
