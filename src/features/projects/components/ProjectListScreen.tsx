import Link from "next/link";
import type { Route } from "next";
import { Boxes } from "lucide-react";

import {
  NAME_CELL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageTitle } from "@/components/atoms/PageTitle";
import { PageContainer } from "@/components/molecules/PageContainer";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { TablePagination } from "@/components/organisms/TablePagination";
import { projectSectionHref } from "@/config/navigation";
import { CreateProjectButton } from "@/features/projects/components/CreateProjectButton";
import { findProjectSummaryPage } from "@/features/projects/server/project-service";
import { formatDate } from "@/lib/format/date";
import {
  listPageHref,
  parsePageRequest,
  type RawSearchParams,
} from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";

/**
 * Project 목록 화면.
 *
 * `app/` 은 얇게 두고 화면 조립은 Feature 가 한다.
 * Server Component 다 — 조회는 서버에서 하고 서버가 그린다.
 */
export async function ProjectListScreen({
  workspaceId,
  workspaceSlug,
  basePath,
  searchParams,
}: {
  /** 🔴 소속 확인을 통과한 값. URL 의 slug 를 그대로 넣지 않는다. */
  workspaceId: string;
  workspaceSlug: string;
  /** 이 목록 자신의 주소. 쪽을 옮길 때 쓴다. */
  basePath: Route;
  searchParams: Promise<RawSearchParams>;
}) {
  const request = parsePageRequest(await searchParams);
  const [projectPage, messages] = await Promise.all([
    findProjectSummaryPage(workspaceId, request),
    readMessages(),
  ]);
  const projects = projectPage.items;
  const t = messages.projects;

  return (
    <PageContainer width="wide">
      <PageTitle>{messages.metaTitle.projects}</PageTitle>
      {/*
 🔴 **제목은 지우고 Action 만 남긴다.** 사이드바에서 「프로젝트」를 눌러 들어온
 화면이라 같은 낱말을 한 번 더 찍을 이유가 없다 — 그러나 이 줄 자체는 남는다.
 「만들기」가 표 위에서 갈 곳을 잃으면 화면이 목록만 덩그러니 남는다.
 */}
      <div className="flex justify-end">
        <CreateProjectButton workspaceSlug={workspaceSlug} />
      </div>

      <Section variant="raised" bleed>
        {projects.length === 0 ? (
          <SectionEmpty icon={<Boxes className="size-4" />} title={t.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colProject}</TableHead>
                <TableHead className="w-40">{t.colSlug}</TableHead>
                <TableHead className="w-28 text-right">
                  {t.colRepositories}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t.colReviews}
                </TableHead>
                <TableHead className="w-28 text-right">
                  {t.colOpenIssues}
                </TableHead>
                <TableHead className="w-32 text-right">
                  {t.colLastActivity}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.projectId}>
                  <TableCell className={NAME_CELL}>
                    <Link
                      href={projectSectionHref(workspaceSlug, project.slug, "")}
                      title={project.name}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.description !== null && (
                      <span
                        className="mt-0.5 block truncate text-xs font-normal text-muted-foreground"
                        title={project.description}
                      >
                        {project.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className="max-w-[10rem] truncate font-mono text-xs text-muted-foreground"
                    title={project.slug}
                  >
                    {project.slug}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.repositoryCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.reviewCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.openIssueCount}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {project.lastActivityAt === null
                      ? "—"
                      : formatDate(project.lastActivityAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {projectPage.total > 0 && (
          <TablePagination
            total={projectPage.total}
            page={projectPage.page}
            pageSize={projectPage.pageSize}
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
