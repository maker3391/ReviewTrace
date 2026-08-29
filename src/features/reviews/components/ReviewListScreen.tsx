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
import { ListChecks } from "lucide-react";

import { PageContainer } from "@/components/molecules/PageContainer";
import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { listProjectReviews } from "@/features/reviews/server/review-query";
import type { ProjectContext } from "@/features/projects/types/project";
import { formatDate } from "@/lib/format/date";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";

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
  const [reviews, messages] = await Promise.all([
    listProjectReviews({ workspaceId, projectId: project.projectId }),
    readMessages(),
  ]);
  const t = messages.reviews;
  const label = messages.enums;

  return (
    <PageContainer width="wide">
      <PageHeader title={t.title} />

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
                  <TableCell className="max-w-[10rem]">
                    <Link
                      href={`${basePath}/${review.id}` as Route}
                      title={review.reviewerName}
                      className="block truncate font-medium underline-offset-2 hover:underline"
                    >
                      {review.reviewerName}
                    </Link>
                  </TableCell>
                  {/* Repository 이름은 식별자다 — 잘라내지 않고 줄바꿈으로 다룬다. */}
                  <TableCell className={cn(NAME_CELL, "whitespace-normal break-all font-mono text-xs text-muted-foreground")}>
                    {review.repositoryFullName}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {label.targetType[review.targetType]}
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
    </PageContainer>
  );
}
