"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";

import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { deleteKnowledgePageAction } from "@/features/knowledge/actions/knowledge-page-actions";

/**
 * 문서 삭제.
 *
 * 🔴 **되돌릴 수 없는 일이라 한 번 묻는다.** 묻는 자리는 공통 `ConfirmDialog` 하나다 —
 * pending · 실패 표시 · 두 번 눌림 방지가 화면마다 다시 쓰이지 않게(CLAUDE.md 18).
 *
 * 🔴 **정말로 복구할 수 없다.** `deleteKnowledgePage` 는 `knowledge_pages` 행을 그대로
 * `DELETE` 한다(`server/knowledge-page-service.ts`) — soft delete 가 아니다.
 *
 * 실패는 예외가 아니라 `ActionResult` 로 온다(CLAUDE.md 8) — 지워지지 않았는데 화면만
 * 목록으로 돌아가는 일이 없게, 성공했을 때만 이동한다.
 *
 * 🔴 **사전 전체가 아니라 이 버튼이 그리는 낱말만 받는다**(CLAUDE.md 11). 🔴 **문구를
 * 만드는 «함수»를 받지 않는다** — 함수는 Server → Client 경계를 건너지 못해
 * `Functions cannot be passed directly to Client Components` 로 화면이 통째로 죽는다.
 * 제목을 끼워 넣는 일은 서버가 끝낸 뒤 «완성된 문자열»만 내려온다.
 */
export function DeleteKnowledgePageButton({
  workspaceSlug,
  projectSlug,
  slug,
  listPath,
  labels,
}: {
  workspaceSlug: string;
  projectSlug: string | null;
  slug: string;
  listPath: Route;
  labels: {
    delete: string;
    cancel: string;
    confirmTitle: string;
    /** 🔴 문서 제목이 «이미 끼워진» 문장이다. */
    confirmDescription: string;
    confirmConsequence: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {labels.delete}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={labels.confirmTitle}
        /*
          🔴 **대상과 결과를 한 문단으로 붙이지 않는다.** 앞줄은 「무엇을 지우는가」이고
          뒷줄은 「그래서 어떻게 되는가」다 — 이어 붙이면 문서 제목 뒤에 경고가 묻힌다.
        */
        description={labels.confirmDescription}
        consequence={labels.confirmConsequence}
        actionLabel={labels.delete}
        cancelLabel={labels.cancel}
        onConfirm={async () => {
          const result = await deleteKnowledgePageAction({
            workspaceSlug,
            projectSlug,
            slug,
          });

          if (result.ok) {
            router.push(listPath);
          }

          return result;
        }}
      />
    </>
  );
}
