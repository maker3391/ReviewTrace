import Link from "next/link";
import type { Route } from "next";

import { MarkdownView } from "@/components/molecules/MarkdownView";
import { PageContainer } from "@/components/molecules/PageContainer";
import { Button } from "@/components/ui/button";
import { DeleteKnowledgePageButton } from "@/features/knowledge/components/DeleteKnowledgePageButton";
import type { KnowledgePageDetail } from "@/features/knowledge/server/knowledge-page-service";
import { formatDate } from "@/lib/format/date";
import { readMessages } from "@/lib/ui/appearance";

/**
 * Wiki 문서 상세.
 *
 * Server Component 다 — 문구를 서버에서 정해 첫 응답부터 맞는 언어로 나가고,
 * 삭제 버튼(Client)에는 **그 버튼이 그리는 낱말만** 내려보낸다.
 *
 * 본문은 `MarkdownView` 가 그린다. 🔴 **raw HTML 을 렌더하지 않는다** — 위험한 노드를
 * 만든 뒤 지우는 것이 아니라 처음부터 만들지 않는다(`components/molecules/MarkdownView.tsx`).
 *
 * 🔴 **Row 마다 Button 을 늘어놓지 않는다**. 머리글에 수정·삭제 둘뿐이다.
 */
export async function KnowledgePageView({
  page,
  workspaceSlug,
  projectSlug,
  basePath,
}: {
  page: KnowledgePageDetail;
  workspaceSlug: string;
  projectSlug: string | null;
  basePath: Route;
}) {
  const t = (await readMessages()).wikiPage;

  return (
    /*
 🔴 **Wiki 본문은 넓히지 않는다.** 여기는 목록·표가 아니라 사람이 읽는 글이라,
 Issue 목록과 같은 폭으로 늘리면 한 줄이 200자를 넘어 눈이 줄을 놓친다
 (`components/molecules/PageContainer.tsx`).
 */
    <PageContainer width="reading" className="gap-4">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {page.title}
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{page.slug}</span>
            {" · "}
            {page.authorName ?? t.noAuthor}
            {" · "}
            {t.updatedAt(formatDate(page.updatedAt))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild size="sm" variant="outline">
            <Link href={`${basePath}/${page.slug}/edit` as Route}>
              {t.edit}
            </Link>
          </Button>
          <DeleteKnowledgePageButton
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            slug={page.slug}
            listPath={basePath}
            /* 🔴 사전이 아니라 «이 버튼이 그리는 낱말»만, 함수가 아니라 «완성된 문자열»로. */
            labels={{
              delete: t.delete,
              cancel: t.cancel,
              confirmTitle: t.deleteConfirm,
              confirmDescription: t.deleteDescription(page.title),
              confirmConsequence: t.deleteConsequence,
            }}
          />
        </div>
      </header>

      <MarkdownView content={page.content} emptyLabel={t.emptyBody} />

      <Link
        href={basePath}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        ← {t.backToList}
      </Link>
    </PageContainer>
  );
}
