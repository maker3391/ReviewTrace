"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  hasInstallation,
  allAccessibleConnected,
  mode,
  labels,
}: {
  workspaceSlug: string;
  projectSlug: string;
  repositories: RepositoryOption[];
  hasInstallation: boolean;
  allAccessibleConnected: boolean;
  mode: "empty" | "inline" | "dialog";
  labels: {
    connect: string;
    install: string;
    choose: string;
    private: string;
    public: string;
    connected: string;
    add: string;
    noAccessible: string;
    allConnected: string;
    updateAccess: string;
    cancel: string;
  };
}) {
  const [open, setOpen] = useState(false);
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
      if (!result.ok) return setError(result.error.message);
      setOpen(false);
    });

  const unavailable = !hasInstallation || repositories.length === 0;
  const installPrompt = (
    <div className="flex flex-col items-center gap-2">
      {hasInstallation && (
        <p className="text-xs text-muted-foreground">
          {allAccessibleConnected ? labels.allConnected : labels.noAccessible}
        </p>
      )}
      <Button type="button" onClick={install} disabled={pending}>
        <GithubMark className="size-4" />
        {hasInstallation ? labels.updateAccess : labels.install}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );

  const picker = (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <label htmlFor={`github-repository-${mode}`} className="sr-only">
        {labels.choose}
      </label>
      <select
        id={`github-repository-${mode}`}
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
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
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );

  if (mode === "dialog") {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            {labels.add}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.add}</DialogTitle>
            <DialogDescription>{labels.choose}</DialogDescription>
          </DialogHeader>
          {unavailable ? (
            installPrompt
          ) : (
            <>
              {picker}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {labels.cancel}
                </Button>
                <Button
                  disabled={pending || selected === ""}
                  onClick={connect}
                >
                  {labels.connect}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  if (unavailable) return installPrompt;

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
      {picker}
      <Button
        type="button"
        onClick={connect}
        disabled={pending || selected === ""}
      >
        {labels.connect}
      </Button>
    </div>
  );
}
