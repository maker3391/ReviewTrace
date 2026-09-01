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
import { TablePagination } from "@/components/organisms/TablePagination";
import {
  findIssues,
  type IssueQueryScope,
} from "@/features/issues/server/issue-query";
import {
  issueFilterToQueryString,
  type IssueFilter,
} from "@/features/issues/schemas/issue-filter";
import { formatDate } from "@/lib/format/date";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";

/**
 * Issue 목록의 데이터 영역.
 *
 * Server Component 다 — 조회는 서버에서 하고 서버가 그린다.
 * 이 Component 만 Suspense 아래에 두어, Filter 를 바꿔도 상단 Toolbar 는 남고 이 자리만 바뀐다.
 */
export async function IssueTable({
  scope,
  filter,
  basePath,
}: {
  /** 🔴 소속 확인을 통과한 값. Client 가 보낸 식별자를 쓰지 않는다. */
  scope: IssueQueryScope;
  filter: IssueFilter;
  /** 상세로 들어가는 주소의 뿌리. 조회 조건이 아니다. */
  basePath: Route;
}) {
  const [result, messages] = await Promise.all([
    findIssues(scope, filter),
    readMessages(),
  ]);
  const t = messages.issues;
  const label = messages.enums;

  if (result.items.length === 0) {
    return <EmptyState title={t.empty} />;
  }

  /**
   * 쪽을 옮겨도 **Filter 는 그대로 실린다.** 주소를 손으로 이어 붙이지 않고 Filter 를
   * Query String 으로 되돌리는 함수를 다시 쓴다 — 그러지 않으면 3쪽으로 가는 순간
   * 검색어가 사라진다.
   */
  const hrefFor = (next: IssueFilter): Route => {
    const queryString = issueFilterToQueryString(next);
    return queryString === ""
      ? basePath
      : (`${basePath}?${queryString}` as Route);
  };

  return (
    <div className="flex flex-col">
      <Table className={ISSUE_TABLE}>
        <TableHeader>
          <TableRow>
            <TableHead className={ISSUE_COL.severity}>
              {t.colSeverity}
            </TableHead>
            <TableHead>{t.colTitle}</TableHead>
            <TableHead className={ISSUE_COL.category}>
              {t.colCategory}
            </TableHead>
            <TableHead className={ISSUE_COL.location}>
              {t.colLocation}
            </TableHead>
            <TableHead className={ISSUE_COL.status}>{t.colStatus}</TableHead>
            <TableHead className={ISSUE_COL.detected}>
              {t.colDetected}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.items.map((issue) => (
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
 내린다 — 옆에 붙이면 그만큼 제목이 먼저 잘린다.
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

      {/*
 🔴 표 아래에 「전체 N건 중 x–y」를 «문장»으로 적지 않는다. 총 건수는 숫자 하나로
 족하고 지금 어디인지는 칠해진 쪽 번호가 말한다(`organisms/TablePagination.tsx`).
 */}
      <TablePagination
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        pageHref={(page) => hrefFor({ ...filter, page })}
        // 쪽 크기를 바꾸면 첫 쪽으로 — 25개씩의 7쪽은 100개씩에서 없는 자리다.
        pageSizeHref={(pageSize) => hrefFor({ ...filter, page: 1, pageSize })}
        labels={messages.common.pagination}
      />
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="px-4 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
    </div>
  );
}
