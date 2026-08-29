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
import { ListChecks } from "lucide-react";

import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { listProjectReviews } from "@/features/reviews/server/review-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";
import { readMessages } from "@/lib/ui/appearance";

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
  basePath,
}: {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  project: ProjectContext;
  /** 상세로 들어가는 주소의 뿌리. */
  basePath: Route;
}) {
  const [reviews, t] = await Promise.all([
    listProjectReviews({ workspaceId, projectId: project.projectId }),
    readMessages().then((messages) => messages.reviews),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader title={t.title} description={t.description(project.name)} />

      <Section variant="raised" bleed>
        {reviews.length === 0 ? (
          <SectionEmpty icon={<ListChecks className="size-4" />} title={t.empty}>
            {t.emptyHint}
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t.colReviewer}</TableHead>
                <TableHead>{t.colRepository}</TableHead>
                <TableHead className="w-28">{t.colTarget}</TableHead>
                <TableHead className="w-56">{t.colBranchCommit}</TableHead>
                <TableHead className="w-20 text-right">{t.colIssues}</TableHead>
                <TableHead className="w-28 text-right">{t.colDate}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>
                    <Link
                      href={`${basePath}/${review.id}` as Route}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {review.reviewerName}
                    </Link>
                  </TableCell>
                  {/* Repository 이름은 식별자다 — 잘라내지 않고 줄바꿈으로 다룬다. */}
                  <TableCell className="max-w-64 whitespace-normal break-all font-mono text-xs text-muted-foreground">
                    {review.repositoryFullName}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {review.targetType}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal break-all font-mono text-[11px] text-muted-foreground">
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
      </Section>
    </div>
  );
}
