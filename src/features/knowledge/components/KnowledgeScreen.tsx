import Link from "next/link";
import type { Route } from "next";

import { BookText } from "lucide-react";

import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
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
}: {
  /** 🔴 소속 확인을 통과한 값만 들어온다. */
  scope: { workspaceId: string; projectId: string | null };
  basePath: Route;
  heading: string;
  description: string;
}) {
  const [pages, t] = await Promise.all([
    listKnowledgePages(scope),
    readMessages().then((messages) => messages.wiki),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6">
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
                <TableHead className="w-56">{t.colSlug}</TableHead>
                <TableHead className="w-40">{t.colAuthor}</TableHead>
                <TableHead className="w-32 text-right">{t.colUpdated}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((page) => (
                <TableRow key={page.slug}>
                  <TableCell className="max-w-md">
                    <Link
                      href={`${basePath}/${page.slug}` as Route}
                      title={page.title}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {page.title}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal break-all font-mono text-xs text-muted-foreground">
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
      </Section>
    </div>
  );
}
