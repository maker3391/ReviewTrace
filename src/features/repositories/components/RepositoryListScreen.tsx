import Link from "next/link";
import type { Route } from "next";

import {
  NAME_CELL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, FolderGit2 } from "lucide-react";

import { PageTitle } from "@/components/atoms/PageTitle";
import { PageContainer } from "@/components/molecules/PageContainer";
import { Timestamp } from "@/components/atoms/Timestamp";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { TablePagination } from "@/components/organisms/TablePagination";
import {
  findRepositoryStatusPage,
  listProjectRepositoryIdentities,
} from "@/features/repositories/server/repository-query";
import {
  listWorkspaceGithubInstallations,
  listWorkspaceGithubRepositories,
} from "@/features/repositories/server/github-installation-service";
import { RepositoryConnect } from "@/features/repositories/components/RepositoryConnect";
import type { ProjectContext } from "@/features/projects/types/project";
import {
  listPageHref,
  parsePageRequest,
  type RawSearchParams,
} from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";
import {
  excludeCurrentProjectRepositories,
  repositoryScreenState,
} from "@/features/repositories/components/repository-list-state";

/** Project의 Repository 목록과 Workspace-scoped GitHub App 연결 진입점. */
export async function RepositoryListScreen({
  workspaceId,
  workspaceSlug,
  project,
  basePath,
  searchParams,
}: {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  workspaceSlug: string;
  project: ProjectContext;
  /** 상세로 들어가는 주소의 뿌리. */
  basePath: Route;
  /** 쪽 상태는 URL 에 있다. */
  searchParams: Promise<RawSearchParams>;
}) {
  const request = parsePageRequest(await searchParams);
  const [
    repositoryPage,
    messages,
    githubRepositories,
    githubInstallations,
    connectedRepositoryIdentities,
  ] = await Promise.all([
    findRepositoryStatusPage(
      { workspaceId, projectId: project.projectId },
      request,
    ),
    readMessages(),
    listWorkspaceGithubRepositories(workspaceId),
    listWorkspaceGithubInstallations(workspaceId),
    listProjectRepositoryIdentities({
      workspaceId,
      projectId: project.projectId,
    }),
  ]);
  const repositories = repositoryPage.items;
  const t = messages.repositories;
  const hasInstallation = githubInstallations.length > 0;
  const availableGithubRepositories = excludeCurrentProjectRepositories(
    githubRepositories,
    connectedRepositoryIdentities,
  );
  const allAccessibleConnected =
    githubRepositories.length > 0 && availableGithubRepositories.length === 0;
  const state = repositoryScreenState({
    hasInstallation,
    repositoryCount: repositoryPage.total,
  });
  const connectLabels = {
    connect: t.connect,
    install: t.installGithub,
    choose: t.choose,
    private: t.private,
    public: t.public,
    connected: t.connected,
    add: t.add,
    emptyTitle: t.emptyTitle,
    connectDescription: t.connectDescription,
    noAccessible: t.noAccessible,
    allConnected: t.allConnected,
    updateAccess: t.updateAccess,
    cancel: t.cancel,
  };

  return (
    <PageContainer width="wide">
      <PageTitle>{messages.metaTitle.repositories}</PageTitle>
      {/* 🔴 사이드바가 「저장소」라고 말한 자리에 「저장소」를 한 번 더 적지 않는다. */}
      <Section variant="raised" bleed>
        {state === "GITHUB_DISCONNECTED" ? (
          <SectionEmpty
            icon={<FolderGit2 className="size-4" />}
            title={t.connectTitle}
            action={
              <RepositoryConnect
                workspaceSlug={workspaceSlug}
                projectSlug={project.slug}
                repositories={availableGithubRepositories}
                hasInstallation={false}
                allAccessibleConnected={false}
                mode="empty"
                labels={connectLabels}
              />
            }
          >
            {t.connectDescription}
          </SectionEmpty>
        ) : state === "READY_TO_CONNECT" ? (
          <div className="px-5 py-6">
            <div className="mb-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{t.chooseTitle}</h2>
                <span className="text-xs text-muted-foreground">
                  {t.connected}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.connectDescription}
              </p>
            </div>
            <RepositoryConnect
              workspaceSlug={workspaceSlug}
              projectSlug={project.slug}
              repositories={availableGithubRepositories}
              hasInstallation
              allAccessibleConnected={allAccessibleConnected}
              mode="inline"
              labels={connectLabels}
            />
          </div>
        ) : (
          <>
            <div className="flex justify-end border-b border-border px-4 py-3">
              <RepositoryConnect
                workspaceSlug={workspaceSlug}
                projectSlug={project.slug}
                repositories={availableGithubRepositories}
                hasInstallation={hasInstallation}
                allAccessibleConnected={allAccessibleConnected}
                mode="dialog"
                labels={connectLabels}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colRepository}</TableHead>
                  <TableHead className="w-32">{t.colDefaultBranch}</TableHead>
                  <TableHead className="w-24 text-right">
                    {t.colReviews}
                  </TableHead>
                  <TableHead className="w-28 text-right">
                    {t.colOpenIssues}
                  </TableHead>
                  <TableHead className="w-32 text-right">
                    {t.colLastReview}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.map((repository) => (
                  <TableRow key={repository.id}>
                    {/*
 🔴 **이름과 바깥으로 나가는 링크를 «줄»로 가른다.**

 둘 다 inline 이라, `break-all` 로 끊기는 긴 이름의 마지막 글자 바로 뒤에 링크가
 붙어 한 문자열처럼 읽혔다 — `…testing-purposes-hereGitHub에서 보기 ↗`.
 `mt-1` 은 inline 요소에서 아무 일도 하지 않아 간격이 생기지 않았다.

 셀 안을 **식별자 영역 + 보조 action 영역**으로만 나눈다. 열을 더하지 않는 이유는
 그 편이 표를 옆으로 늘리고 이름을 묻기 때문이다(CLAUDE.md 16 — 「한 셀 안에서
 계층을 만들 수 있다」). `items-start` 라 링크가 셀 폭만큼 늘어나지 않고,
 이름이 아무리 길어도 링크를 밀어내지 못한다.
 */}
                    <TableCell className={cn(NAME_CELL, "whitespace-normal")}>
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <Link
                          href={`${basePath}/${repository.id}` as Route}
                          className="block max-w-full break-all font-mono text-xs underline-offset-4 hover:underline"
                        >
                          {repository.fullName}
                        </Link>
                        {repository.htmlUrl !== null &&
                          isSafeExternalUrl(repository.htmlUrl) && (
                            <a
                              href={repository.htmlUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                            >
                              {t.viewGithub}
                              <ExternalLink className="size-3" aria-hidden />
                            </a>
                          )}
                      </div>
                    </TableCell>
                    <TableCell
                      className="max-w-[8rem] truncate font-mono text-xs text-muted-foreground"
                      title={repository.defaultBranch}
                    >
                      {repository.defaultBranch}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {repository.reviewCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {repository.openIssueCount}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      <Timestamp
                        value={repository.lastReviewAt}
                        variant="compact"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {repositoryPage.total > 0 && (
          <TablePagination
            total={repositoryPage.total}
            page={repositoryPage.page}
            pageSize={repositoryPage.pageSize}
            pageHref={(page) =>
              listPageHref(basePath, { ...request, page }) as Route
            }
            pageSizeHref={(pageSize) =>
              listPageHref(basePath, { page: 1, pageSize }) as Route
            }
            labels={messages.common.pagination}
          />
        )}
      </Section>
    </PageContainer>
  );
}

function isSafeExternalUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
