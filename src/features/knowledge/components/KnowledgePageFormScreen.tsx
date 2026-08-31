import type { Route } from "next";

import { PageContainer } from "@/components/molecules/PageContainer";
import { KnowledgePageForm } from "@/features/knowledge/components/KnowledgePageForm";
import { readMessages } from "@/lib/ui/appearance";

/**
 * Wiki 문서를 쓰는 화면.
 *
 * Server Component 다 — 문구를 서버에서 정해 첫 응답부터 맞는 언어로 나가고(`config/i18n.ts`),
 * 폼만 Client 로 내려간다. 🔴 **사전 전체가 아니라 이 화면이 쓰는 낱말만**
 * 넘긴다.
 *
 * 🔴 **폭은 본문 화면과 같다**(`width="reading"`). 쓰는 자리와 읽는 자리의 한 줄 길이가
 * 다르면 줄바꿈이 어디서 일어날지 가늠하며 쓸 수 없다(`components/molecules/PageContainer.tsx`).
 */
export async function KnowledgePageFormScreen({
 workspaceSlug,
 projectSlug,
 listPath,
 current,
}: {
 workspaceSlug: string;
 /** `null` 이면 Workspace Knowledge. */
 projectSlug: string | null;
 listPath: Route;
 /** 수정이면 현재 값, 새로 쓰는 것이면 `null`. */
 current: { slug: string; title: string; content: string } | null;
}) {
 const t = (await readMessages()).wiki.form;

 return (
 <PageContainer width="reading">
 <KnowledgePageForm
 workspaceSlug={workspaceSlug}
 projectSlug={projectSlug}
 listPath={listPath}
 current={current}
 labels={t}
 />
 </PageContainer>
);
}
