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
import { FolderGit2 } from "lucide-react";

import { PageContainer } from "@/components/molecules/PageContainer";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { TablePagination } from "@/components/organisms/TablePagination";
import { findRepositoryStatusPage } from "@/features/repositories/server/repository-query";
import { listWorkspaceGithubRepositories } from "@/features/repositories/server/github-installation-service";
import { RepositoryConnect } from "@/features/repositories/components/RepositoryConnect";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";
import {
  listPageHref,
  parsePageRequest,
  type RawSearchParams,
} from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";

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
  const [repositoryPage, messages, githubRepositories] = await Promise.all([
    findRepositoryStatusPage(
      { workspaceId, projectId: project.projectId },
      request,
    ),
    readMessages(),
    listWorkspaceGithubRepositories(workspaceId),
  ]);
  const repositories = repositoryPage.items;
  const t = messages.repositories;

  return (
    <PageContainer width="wide">
      {/* 🔴 사이드바가 「저장소」라고 말한 자리에 「저장소」를 한 번 더 적지 않는다. */}
      <Section variant="raised" bleed>
        {repositories.length === 0 ? (
          <SectionEmpty
            icon={<FolderGit2 className="size-4" />}
            title={t.empty}
            action={
              <RepositoryConnect
                workspaceSlug={workspaceSlug}
                projectSlug={project.slug}
                repositories={githubRepositories}
                labels={{
                  connect: t.connect,
                  install: t.installGithub,
                  choose: t.choose,
                  private: t.private,
                  public: t.public,
                }}
              />
            }
          />
        ) : (
          <>
            <div className="flex justify-end border-b border-border px-4 py-3">
              <RepositoryConnect
                workspaceSlug={workspaceSlug}
                projectSlug={project.slug}
                repositories={githubRepositories}
                labels={{
                  connect: t.connect,
                  install: t.installGithub,
                  choose: t.choose,
                  private: t.private,
                  public: t.public,
                }}
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
                    <TableCell className={cn(NAME_CELL, "whitespace-normal")}>
                      <Link
                        href={`${basePath}/${repository.id}` as Route}
                        className="break-all font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {repository.fullName}
                      </Link>
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
                      {repository.lastReviewAt === null
                        ? "—"
                        : formatDate(repository.lastReviewAt)}
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
