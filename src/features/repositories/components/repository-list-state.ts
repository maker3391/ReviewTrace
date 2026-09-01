export type RepositoryScreenState =
  | "GITHUB_DISCONNECTED"
  | "READY_TO_CONNECT"
  | "CONNECTED_REPOSITORIES";

export function repositoryScreenState(input: {
  hasInstallation: boolean;
  repositoryCount: number;
}): RepositoryScreenState {
  if (input.repositoryCount > 0) return "CONNECTED_REPOSITORIES";
  return input.hasInstallation ? "READY_TO_CONNECT" : "GITHUB_DISCONNECTED";
}

/**
 * A repository already connected to this Project is not an actionable picker item.
 * Repositories connected to another Project remain visible so the existing explicit
 * move/conflict policy can explain their current location.
 */
export function excludeCurrentProjectRepositories<
  T extends { externalRepositoryId: string; fullName: string },
>(
  repositories: readonly T[],
  connected: readonly { externalRepositoryId: string; fullName: string }[],
): T[] {
  const externalIds = new Set(
    connected.map((repository) => repository.externalRepositoryId),
  );
  const fullNames = new Set(
    connected.map((repository) => repository.fullName.toLowerCase()),
  );
  return repositories.filter(
    (repository) =>
      !externalIds.has(repository.externalRepositoryId) &&
      !fullNames.has(repository.fullName.toLowerCase()),
  );
}
