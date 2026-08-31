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
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";
import {
  listPageHref,
  parsePageRequest,
  type RawSearchParams,
} from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";

/**
 * Project 의 Repository 목록.
 *
 * 🔴 **Repository 를 화면에서 만들지 않는다.** 등록 경로는 Agent Review 하나뿐이다 —
 * Agent 가 Review 를 보낼 때 `externalRepositoryId` 로 Upsert 된다
 * (`review-ingest-service.ts`). GitHub 을 직접 붙여 목록을 가져오는 것은 아직 없다.
 *
 * 있는 것처럼 보이는 버튼을 두지 않는다 — 없는 기능보다 나쁘다.
 */
export async function RepositoryListScreen({
  workspaceId,
  project,
  basePath,
  searchParams,
}: {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  project: ProjectContext;
  /** 상세로 들어가는 주소의 뿌리. */
  basePath: Route;
  /** 쪽 상태는 URL 에 있다(CLAUDE.md 8). */
  searchParams: Promise<RawSearchParams>;
}) {
  const request = parsePageRequest(await searchParams);
  const [repositoryPage, messages] = await Promise.all([
    findRepositoryStatusPage(
      { workspaceId, projectId: project.projectId },
      request,
    ),
    readMessages(),
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
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colRepository}</TableHead>
                <TableHead className="w-32">{t.colDefaultBranch}</TableHead>
                <TableHead className="w-24 text-right">{t.colReviews}</TableHead>
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
