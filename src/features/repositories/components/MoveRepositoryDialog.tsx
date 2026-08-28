"use client";

import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { moveRepositoryAction } from "@/features/repositories/actions/move-repository";

/**
 * Repository 를 다른 Project 로 옮긴다.
 *
 * 🔴 **Agent 가 이 결정을 덮어쓰지 않는다.** Review Ingest 는 Repository 를 Upsert 할 때
 * `project_id` 를 갱신하지 않는다(`review-ingest-service.ts`) — 여기서 옮겨 둔 것이 다음
 * Review 에 되돌아가면 안 되기 때문이다.
 *
 * 🔴 **목록은 서버가 소속을 확인해 넘긴 것**이다. 이 Component 는 slug 를 고를 뿐이고,
 * 실제 이동은 Server Action 이 다시 확인한 뒤에 한다.
 */
export function MoveRepositoryDialog({
  workspaceSlug,
  projectSlug,
  repositoryId,
  repositoryFullName,
  projectOptions,
}: {
  workspaceSlug: string;
  projectSlug: string;
  repositoryId: string;
  repositoryFullName: string;
  projectOptions: readonly { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // 지금 있는 Project 는 고를 수 없다 — 옮길 곳이 아니다.
  const options = projectOptions.filter((item) => item.slug !== projectSlug);

  if (options.length === 0) {
    // 옮길 곳이 없으면 버튼을 두지 않는다 — 눌러서 아무 일도 없는 버튼을 만들지 않는다.
    return null;
  }

  async function onMove() {
    if (target === null) {
      return;
    }

    setPending(true);
    setFailure(null);

    const result = await moveRepositoryAction({
      workspaceSlug,
      projectSlug,
      repositoryId,
      targetProjectSlug: target,
    });

    setPending(false);

    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }

    setOpen(false);
    // 이 Repository 는 더 이상 이 Project 것이 아니다 — 옮겨 간 Project 의 목록으로 보낸다.
    router.push(`/w/${workspaceSlug}/p/${target}/repositories`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Project 이동
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">Project 이동</DialogTitle>
          <DialogDescription>
            {repositoryFullName} 과 그 아래 Review·Issue 가 함께 옮겨집니다.
          </DialogDescription>
        </DialogHeader>

        <Select value={target ?? undefined} onValueChange={setTarget}>
          <SelectTrigger aria-label="옮길 Project">
            <SelectValue placeholder="옮길 Project 를 고르세요" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.slug} value={option.slug}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
          <Button size="sm" onClick={onMove} disabled={pending || target === null}>
            {pending ? "옮기는 중" : "옮기기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
