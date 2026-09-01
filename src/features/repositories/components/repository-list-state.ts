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
