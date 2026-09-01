"use client";

import { useState, useTransition } from "react";
import { LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GithubMark } from "@/features/auth/components/GithubMark";
import {
  beginGithubInstallationAction,
  connectGithubRepositoryAction,
} from "@/features/repositories/actions/connect-repository";

interface RepositoryOption {
  installationId: string;
  externalRepositoryId: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export function RepositoryConnect({
  workspaceSlug,
  projectSlug,
  repositories,
  labels,
}: {
  workspaceSlug: string;
  projectSlug: string;
  repositories: RepositoryOption[];
  labels: {
    connect: string;
    install: string;
    choose: string;
    private: string;
    public: string;
  };
}) {
  const [selected, setSelected] = useState(
    repositories[0]
      ? `${repositories[0].installationId}:${repositories[0].externalRepositoryId}`
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const install = () =>
    startTransition(async () => {
      setError(null);
      const result = await beginGithubInstallationAction({
        workspaceSlug,
        projectSlug,
      });
      if (!result.ok) return setError(result.error.message);
      window.location.assign(result.data.url);
    });

  const connect = () =>
    startTransition(async () => {
      setError(null);
      const [installationId, externalRepositoryId] = selected.split(":");
      if (!installationId || !externalRepositoryId) return;
      const result = await connectGithubRepositoryAction({
        workspaceSlug,
        projectSlug,
        installationId,
        externalRepositoryId,
      });
      if (!result.ok) setError(result.error.message);
    });

  return (
    <div className="flex max-w-xl flex-col items-center gap-3 text-center">
      {repositories.length === 0 ? (
        <Button type="button" onClick={install} disabled={pending}>
          <GithubMark className="size-4" />
          {labels.install}
        </Button>
      ) : (
        <div className="flex w-full items-center gap-2">
          <label htmlFor="github-repository" className="sr-only">
            {labels.choose}
          </label>
          <select
            id="github-repository"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
          >
            {repositories.map((repository) => (
              <option
                key={`${repository.installationId}:${repository.externalRepositoryId}`}
                value={`${repository.installationId}:${repository.externalRepositoryId}`}
              >
                {repository.fullName} ·{" "}
                {repository.private ? labels.private : labels.public} ·{" "}
                {repository.defaultBranch}
              </option>
            ))}
          </select>
          <Button
            type="button"
            onClick={connect}
            disabled={pending || selected === ""}
          >
            <LockKeyhole className="size-4" />
            {labels.connect}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={install}
            disabled={pending}
            aria-label={labels.install}
          >
            <GithubMark className="size-4" />
          </Button>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
