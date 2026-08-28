"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteKnowledgePageAction } from "@/features/knowledge/actions/knowledge-page-actions";

/**
 * 문서 삭제.
 *
 * 🔴 **되돌릴 수 없는 일이라 한 번 묻는다.** `window.confirm` 을 쓰지 않는다 —
 * 브라우저 모달은 자동화 도구에서 세션을 통째로 멈추게 한다.
 *
 * 실패는 예외가 아니라 `ActionResult` 로 온다(CLAUDE.md 8) — 지워지지 않았는데 화면만
 * 목록으로 돌아가는 일이 없게, 성공했을 때만 이동한다.
 */
export function DeleteKnowledgePageButton({
  workspaceSlug,
  projectSlug,
  slug,
  title,
  listPath,
}: {
  workspaceSlug: string;
  projectSlug: string | null;
  slug: string;
  title: string;
  listPath: Route;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function onDelete() {
    setPending(true);
    setFailure(null);

    const result = await deleteKnowledgePageAction({
      workspaceSlug,
      projectSlug,
      slug,
    });

    setPending(false);

    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }

    setOpen(false);
    router.push(listPath);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          삭제
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">문서를 삭제합니다</DialogTitle>
          <DialogDescription>
            &lsquo;{title}&rsquo; 을(를) 지웁니다. 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        {failure !== null && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}

        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            취소
          </Button>
          <Button size="sm" onClick={onDelete} disabled={pending}>
            {pending ? "삭제 중" : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
