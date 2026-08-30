import Link from "next/link";
import type { Route } from "next";

import { BookText } from "lucide-react";

import { PageContainer } from "@/components/molecules/PageContainer";
import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { Button } from "@/components/ui/button";
import {
  NAME_CELL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/organisms/TablePagination";
import { findKnowledgePageList } from "@/features/knowledge/server/knowledge-page-service";
import { formatDate } from "@/lib/format/date";
import {
  listPageHref,
  parsePageRequest,
  type RawSearchParams,
} from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";

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
  searchParams,
}: {
  /** 🔴 소속 확인을 통과한 값만 들어온다. */
  scope: { workspaceId: string; projectId: string | null };
  basePath: Route;
  /**
   * 🔴 **여기 제목은 남긴다.** 「위키」를 되풀이하는 것이 아니라 **어느 위키인가**를
   * 가른다 — 사이드바의 Workspace 층과 Project 층에 같은 이름의 항목이 있고, 아래
   * `description` 이 「여기에 무엇을 적는가」를 잇는다(`config/messages/ko.ts`).
   */
  heading: string;
  description: string;
  searchParams: Promise<RawSearchParams>;
}) {
  const request = parsePageRequest(await searchParams);
  const [wikiPage, messages] = await Promise.all([
    findKnowledgePageList(scope, request),
    readMessages(),
  ]);
  const pages = wikiPage.items;
  const t = messages.wiki;

  return (
    <PageContainer width="wide">
      <PageHeader
        title={heading}
        description={description}
        actions={
          <Button asChild size="sm">
            <Link href={`${basePath}/new` as Route}>{t.create}</Link>
          </Button>
        }
      />

      <Section variant="raised" bleed>
        {pages.length === 0 ? (
          <SectionEmpty icon={<BookText className="size-4" />} title={t.empty}>
            {t.emptyHint}
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colTitle}</TableHead>
                <TableHead className="w-40">{t.colSlug}</TableHead>
                <TableHead className="w-40">{t.colAuthor}</TableHead>
                <TableHead className="w-32 text-right">{t.colUpdated}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((page) => (
                <TableRow key={page.slug}>
                  <TableCell className={NAME_CELL}>
                    <Link
                      href={`${basePath}/${page.slug}` as Route}
                      title={page.title}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {page.title}
                    </Link>
                  </TableCell>
                  {/*
                    🔴 **slug 는 이 행의 «주인공»이 아니다.** 제목이 식별자고 slug 는 그
                    보조라, 좁은 폭에서 자리를 다투면 slug 가 먼저 접힌다. `break-all` 로
                    두면 390 에서 이 칸이 54px 이 되어 **한 행이 101px(7줄)** 로 늘어났다 —
                    제목이 40px 한 줄인데 slug 때문에 행이 세 배가 됐다. 실측한 값이다.

                    그래서 Projects 목록의 slug 칸과 **같은 방식**으로 다룬다 —
                    제 폭 안에서 잘리고 전문은 `title` 로 확인한다
                    (`features/projects/components/ProjectListScreen.tsx`).
                  */}
                  <TableCell
                    className="max-w-[10rem] truncate font-mono text-xs text-muted-foreground"
                    title={page.slug}
                  >
                    {page.slug}
                  </TableCell>
                  <TableCell className="max-w-[10rem] truncate text-xs text-muted-foreground">
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

        {wikiPage.total > 0 && (
          <TablePagination
            total={wikiPage.total}
            page={wikiPage.page}
            pageSize={wikiPage.pageSize}
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
