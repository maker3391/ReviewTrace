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
import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { listRepositoryStatuses } from "@/features/repositories/server/repository-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";
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
}: {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  project: ProjectContext;
  /** 상세로 들어가는 주소의 뿌리. */
  basePath: Route;
}) {
  const [repositories, t] = await Promise.all([
    listRepositoryStatuses({ workspaceId, projectId: project.projectId }),
    readMessages().then((messages) => messages.repositories),
  ]);

  return (
    <PageContainer width="wide">
      <PageHeader title={t.title} />

      <Section variant="raised" bleed>
        {repositories.length === 0 ? (
          <SectionEmpty icon={<FolderGit2 className="size-4" />} title={t.empty}>
            {t.emptyHint}
          </SectionEmpty>
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
      </Section>
    </PageContainer>
  );
}
