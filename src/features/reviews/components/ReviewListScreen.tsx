import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { findProjectReviews } from "@/features/dashboard/server/project-dashboard-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";

/**
 * Project 의 Review 목록.
 *
 * 🔴 **Review 대상은 Pull Request 에 한정하지 않는다**(CLAUDE.md 2). `targetType` 이
 * `COMMIT`·`BRANCH`·`REPOSITORY`·`MANUAL` 일 수 있으므로 PR 번호를 앞세우지 않는다 —
 * PR 은 Optional Metadata 다.
 */
export async function ReviewListScreen({
  workspaceId,
  project,
}: {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  project: ProjectContext;
}) {
  const reviews = await findProjectReviews({
    workspaceId,
    projectId: project.projectId,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <h1 className="text-base font-semibold tracking-tight">Reviews</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {project.name} 에서 실행된 Code Review
        </p>
      </div>

      <div className="mt-4">
        {reviews.length === 0 ? (
          <p className="px-4 py-16 text-center text-xs text-muted-foreground">
            아직 Review 가 없습니다. Agent 가 POST /api/v1/reviews 로 결과를 보내면
            여기에 쌓입니다.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Reviewer</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead className="w-28">Target</TableHead>
                <TableHead className="w-56">Branch · Commit</TableHead>
                <TableHead className="w-20 text-right">Issues</TableHead>
                <TableHead className="w-28 text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell className="font-medium">
                    {review.reviewerName}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {review.repositoryFullName}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {review.targetType}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {review.branch ?? "—"}
                    {review.commitSha !== null &&
                      ` · ${review.commitSha.slice(0, 7)}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {review.issueCount}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatDate(review.createdAt)}
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
