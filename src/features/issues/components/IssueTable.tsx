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
  ISSUE_COL,
  ISSUE_TABLE,
} from "@/features/issues/components/issue-table-columns";
import {
  findIssues,
  type IssueQueryScope,
} from "@/features/issues/server/issue-query";
import type { IssueFilter } from "@/features/issues/schemas/issue-filter";
import { formatDate } from "@/lib/format/date";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";

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
  const [page, messages] = await Promise.all([
    findIssues(scope, filter),
    readMessages(),
  ]);
  const t = messages.issues;
  const label = messages.enums;

  if (page.items.length === 0) {
    return <EmptyState title={t.empty} description={t.emptyHint} />;
  }

  return (
    <div className="flex flex-col">
      <Table className={ISSUE_TABLE}>
        <TableHeader>
          <TableRow>
            <TableHead className={ISSUE_COL.severity}>
              {t.colSeverity}
            </TableHead>
            <TableHead>{t.colTitle}</TableHead>
            <TableHead className={ISSUE_COL.category}>{t.colCategory}</TableHead>
            <TableHead className={ISSUE_COL.location}>{t.colLocation}</TableHead>
            <TableHead className={ISSUE_COL.status}>{t.colStatus}</TableHead>
            <TableHead className={ISSUE_COL.detected}>{t.colDetected}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.map((issue) => (
            <TableRow key={issue.id}>
              <TableCell>
                <SeverityBadge severity={issue.severity} />
              </TableCell>
              {/*
                🔴 **제목은 «남는 폭을 전부 가져가는» 유일한 칸이다.** 예전에는 이 칸에
                `max-w-md` 가 걸려 있어 화면이 아무리 넓어도 448px 에서 잘렸다 —
                바깥에 500px 이 비어 있는데 제목만 「…」로 끝났다.
                지금은 폭이 «표»에서 정해지므로 여기서 다시 잠그지 않는다.

                잘린 제목의 전문은 `title` 로 확인한다. Pattern 은 제목 아래 보조 줄로
                내린다 — 옆에 붙이면 그만큼 제목이 먼저 잘린다(CLAUDE.md 16).
              */}
              <TableCell>
                <Link
                  href={`${basePath}/${issue.id}` as Route}
                  title={issue.title}
                  className="block truncate font-medium underline-offset-4 hover:underline"
                >
                  {issue.title}
                </Link>
                {issue.patternKey !== null && (
                  <span
                    className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground"
                    title={issue.patternKey}
                  >
                    {issue.patternKey}
                  </span>
                )}
              </TableCell>
              <TableCell
                className={cn(
                  ISSUE_COL.category,
                  "truncate font-mono text-xs text-muted-foreground",
                )}
                title={label.category[issue.category]}
              >
                {label.category[issue.category]}
              </TableCell>
              {/*
                Repository 와 파일은 «어디였는가» 한 덩어리다 — 열을 둘로 쪼개면 표가 옆으로
                길어지고 제목이 묻힌다. 둘 다 잘라 내되 전문은 `title` 에 남긴다.
              */}
              <TableCell className={cn(ISSUE_COL.location, "overflow-hidden")}>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={issue.repositoryFullName}
                >
                  {issue.repositoryFullName}
                </span>
                <CodeLocation
                  className="block truncate"
                  filePath={issue.filePath}
                  lineStart={issue.startLine}
                  lineEnd={issue.endLine}
                />
              </TableCell>
              <TableCell>
                <StatusBadge status={issue.status} />
              </TableCell>
              <TableCell
                className={cn(
                  ISSUE_COL.detected,
                  "text-xs text-muted-foreground tabular-nums",
                )}
              >
                {formatDate(issue.firstDetectedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="px-4 py-3 text-xs text-muted-foreground">
        {t.pagination(
          page.total,
          (page.page - 1) * page.pageSize + 1,
          (page.page - 1) * page.pageSize + page.items.length,
        )}
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
