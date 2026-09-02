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
import { cn } from "@/lib/utils";
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
    emptyTitle: string;
    connectDescription: string;
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
  /**
   * 🔴 **결과부터 말하고, 그 다음에 할 일을 준다.**
   *
   * 예전에는 「접근 가능한 저장소가 모두 연결되어 있습니다」한 줄 아래 「GitHub 접근 범위
   * 변경」 버튼이 있었다. 둘 다 우리 쪽 구현을 설명하는 말이라, **다른 저장소를 붙이려고**
   * 이 Dialog 를 연 사람은 자기 목적이 어디로 갔는지 알 수 없었다. 지금은
   * 「추가할 수 있는 저장소가 없습니다」로 상태를 먼저 못 박고, 왜 그런지와 무엇을 하면
   * 되는지를 잇고, 버튼은 갈 곳(GitHub)을 이름으로 말한다.
   */
  /**
   * 🔴 **고를 것이 없는 상태에서만 가운데로 모은다.**
   *
   * 이 자리에는 문장 두 개와 버튼 하나뿐이라, 왼쪽 정렬이면 넓은 Dialog 안에서 글이
   * 한쪽에 몰려 어정쩡하게 보인다. 안내·Empty 는 **읽고 한 번 누르는** 화면이므로
   * 가운데 정렬이 맞다.
   *
   * 🔴 **그런데 목록 상태까지 가운데로 끌고 가지 않는다.** 저장소를 여러 개 훑어
   * 고르는 자리는 scanability 가 먼저라 왼쪽 정렬이 맞다(CLAUDE.md 16).
   * 그래서 정렬은 `installPrompt` 에만 걸고 `picker` 는 손대지 않는다.
   * 닫기 X 는 `DialogContent` 의 것이라 그대로 우측 상단이다.
   */
  const installPrompt = (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      {hasInstallation && (
        <>
          <p className="text-sm font-medium">{labels.emptyTitle}</p>
          <p className="max-w-sm text-xs leading-relaxed text-balance text-muted-foreground">
            {allAccessibleConnected ? labels.allConnected : labels.noAccessible}
          </p>
        </>
      )}
      <Button
        type="button"
        onClick={install}
        disabled={pending}
        className="mt-1"
      >
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
          {/*
 🔴 **제목 바로 아래 「연결할 저장소」를 다시 적지 않는다.** 제목이 이미 「저장소
 추가」라 같은 말이 두 번 서고, 고를 것이 없는 Empty state 에서는 있지도 않은
 목록을 가리킨다. 설명 자리는 **이 Dialog 가 무엇을 하는 곳인가**에 쓴다.

 🔴 **머리글의 정렬은 본문을 따라간다.** 안내·Empty 는 가운데로 모으고, 목록을
 고르는 상태는 왼쪽 그대로다 — 머리글만 따로 놀면 한 Dialog 안에서 축이 둘이 된다.
 */}
          <DialogHeader className={cn(unavailable && "items-center text-center")}>
            <DialogTitle>{labels.add}</DialogTitle>
            <DialogDescription
              className={cn(unavailable && "max-w-sm text-balance")}
            >
              {labels.connectDescription}
            </DialogDescription>
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
