import Link from "next/link";
import type { Route } from "next";

import { CodeLocation } from "@/components/atoms/CodeLocation";
import { SeverityBadge } from "@/components/atoms/SeverityBadge";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  findIssues,
  type IssueQueryScope,
} from "@/features/issues/server/issue-query";
import type { IssueFilter } from "@/features/issues/schemas/issue-filter";

/**
 * Issue 목록의 데이터 영역.
 *
 * Server Component 다 — 조회는 서버에서 하고 서버가 그린다(CLAUDE.md 8).
 * 이 Component 만 Suspense 아래에 두어, Filter 를 바꿔도 상단 Toolbar 는 남고 이 자리만 바뀐다.
 */
export async function IssueTable({
  scope,
  filter,
  basePath,
}: {
  /** 🔴 소속 확인을 통과한 값. Client 가 보낸 식별자를 쓰지 않는다(CLAUDE.md 11). */
  scope: IssueQueryScope;
  filter: IssueFilter;
  /** 상세로 들어가는 주소의 뿌리. 조회 조건이 아니다. */
  basePath: Route;
}) {
  const page = await findIssues(scope, filter);

  if (page.items.length === 0) {
    return (
      <EmptyState
        title="조건에 맞는 Issue 가 없습니다."
        description="Filter 를 넓히거나, Agent 가 Review 결과를 아직 보내지 않았는지 확인하세요."
      />
    );
  }

  return (
    <div className="flex flex-col">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Severity</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="w-44">Category</TableHead>
            <TableHead className="w-56">Location</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-32 text-right">Detected</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.map((issue) => (
            <TableRow key={issue.id}>
              <TableCell>
                <SeverityBadge severity={issue.severity} />
              </TableCell>
              <TableCell>
                <Link
                  href={`${basePath}/${issue.id}` as Route}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {issue.title}
                </Link>
                {issue.patternKey !== null && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {issue.patternKey}
                  </span>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {issue.category}
              </TableCell>
              <TableCell>
                <span className="block text-xs text-muted-foreground">
                  {issue.repositoryFullName}
                </span>
                <CodeLocation
                  filePath={issue.filePath}
                  lineStart={issue.startLine}
                  lineEnd={issue.endLine}
                />
              </TableCell>
              <TableCell>
                <StatusBadge status={issue.status} />
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                {formatDate(issue.firstDetectedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="px-4 py-3 text-xs text-muted-foreground">
        전체 {page.total}건 중 {(page.page - 1) * page.pageSize + 1}–
        {(page.page - 1) * page.pageSize + page.items.length}
      </p>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-4 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// 서버·클라이언트의 Locale 차이로 문자열이 갈리지 않게 형식을 직접 고정한다.
function formatDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
