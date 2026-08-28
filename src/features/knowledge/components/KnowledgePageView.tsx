import Link from "next/link";
import type { Route } from "next";

import { Button } from "@/components/ui/button";
import { DeleteKnowledgePageButton } from "@/features/knowledge/components/DeleteKnowledgePageButton";
import type { KnowledgePageDetail } from "@/features/knowledge/server/knowledge-page-service";
import { formatDate } from "@/lib/format/date";

/**
 * Wiki 문서 상세.
 *
 * 🔴 **Markdown 을 HTML 로 렌더하지 않는다.** 지금은 원문을 그대로 보여 준다 —
 * 렌더러를 넣으려면 Library 를 하나 더 들이고 **사용자가 쓴 문자열을 HTML 로 바꾸는**
 * 경로가 생긴다(XSS). 실제로 필요해지면 그때 sanitize 까지 함께 검토한다(CLAUDE.md 18·19).
 *
 * 🔴 **Row 마다 Button 을 늘어놓지 않는다**(CLAUDE.md 16). 머리글에 수정·삭제 둘뿐이다.
 */
export function KnowledgePageView({
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
  return (
    <article className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {page.title}
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{page.slug}</span>
            {" · "}
            {page.authorName ?? "작성자 없음"}
            {" · "}
            {formatDate(page.updatedAt)} 수정
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild size="sm" variant="outline">
            <Link href={`${basePath}/${page.slug}/edit` as Route}>수정</Link>
          </Button>
          <DeleteKnowledgePageButton
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            slug={page.slug}
            title={page.title}
            listPath={basePath}
          />
        </div>
      </header>

      {page.content === "" ? (
        <p className="text-xs text-muted-foreground">본문이 비어 있습니다.</p>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
          {page.content}
        </pre>
      )}

      <Link
        href={basePath}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        ← 목록
      </Link>
    </article>
  );
}
