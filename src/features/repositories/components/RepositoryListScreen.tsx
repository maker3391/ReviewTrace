import Link from "next/link";
import type { Route } from "next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRepositoryStatuses } from "@/features/repositories/server/repository-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";

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
  const repositories = await listRepositoryStatuses({
    workspaceId,
    projectId: project.projectId,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <h1 className="text-base font-semibold tracking-tight">Repositories</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {project.name} 의 코드베이스
        </p>
      </div>

      <div className="mt-4">
        {repositories.length === 0 ? (
          <p className="px-4 py-16 text-center text-xs text-muted-foreground">
            아직 Repository 가 없습니다. Agent 가 이 Project 로 Review 를 보내면
            자동으로 등록됩니다.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead className="w-32">Default Branch</TableHead>
                <TableHead className="w-24 text-right">Reviews</TableHead>
                <TableHead className="w-28 text-right">Open Issues</TableHead>
                <TableHead className="w-32 text-right">최근 Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repositories.map((repository) => (
                <TableRow key={repository.id}>
                  <TableCell>
                    <Link
                      href={`${basePath}/${repository.id}` as Route}
                      className="font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {repository.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
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
      </div>
    </div>
  );
}
