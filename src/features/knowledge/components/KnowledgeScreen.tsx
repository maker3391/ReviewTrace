import Link from "next/link";
import type { Route } from "next";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listKnowledgePages } from "@/features/knowledge/server/knowledge-page-service";
import { formatDate } from "@/lib/format/date";

/**
 * Wiki 목록 화면.
 *
 * Server Component 다 — 조회는 서버에서 하고 서버가 그린다(CLAUDE.md 8).
 *
 * 🔴 **Wiki 와 Review Knowledge 를 한 목록에 섞지 않는다**(스펙 8). 여기 있는 것은 사람이
 * 적은 것(Explicit Knowledge)뿐이다. Review 가 남긴 Pattern·Resolution 은 Dashboard 가
 * 따로 보여 준다 — 출처가 다르면 같은 표에 담지 않는다.
 */
export async function KnowledgeScreen({
  scope,
  basePath,
  heading,
  description,
}: {
  /** 🔴 소속 확인을 통과한 값만 들어온다. */
  scope: { workspaceId: string; projectId: string | null };
  basePath: Route;
  heading: string;
  description: string;
}) {
  const pages = await listKnowledgePages(scope);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight">{heading}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button asChild size="sm">
          <Link href={`${basePath}/new` as Route}>문서 작성</Link>
        </Button>
      </div>

      <div className="mt-4">
        {pages.length === 0 ? (
          <p className="px-4 py-16 text-center text-xs text-muted-foreground">
            아직 문서가 없습니다. 반복해서 설명하게 되는 규칙부터 적어 두세요.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>제목</TableHead>
                <TableHead className="w-56">slug</TableHead>
                <TableHead className="w-40">작성자</TableHead>
                <TableHead className="w-32 text-right">수정</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((page) => (
                <TableRow key={page.slug}>
                  <TableCell>
                    <Link
                      href={`${basePath}/${page.slug}` as Route}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {page.title}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {page.slug}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {page.authorName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatDate(page.updatedAt)}
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
