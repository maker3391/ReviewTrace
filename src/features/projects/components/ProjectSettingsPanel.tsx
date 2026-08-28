"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteProjectAction,
  updateProjectAction,
} from "@/features/projects/actions/manage-project";
import {
  createProjectSchema,
  type CreateProjectFormValues,
  type CreateProjectInput,
} from "@/features/projects/schemas/project";
import type { ProjectDeletionImpact } from "@/features/projects/server/project-service";

/**
 * Project 수정·삭제.
 *
 * 🔴 **삭제는 되돌릴 수 없고 아래가 함께 사라진다.** FK 가 전부 `ON DELETE CASCADE` 라
 * Repository · Review · Issue · Activity · Project Knowledge 가 같이 지워진다.
 * 그래서 **무엇을 잃는지 숫자로 먼저 보여 주고**, Project 이름을 그대로 입력받는다 —
 * 「확인」 버튼 하나로 지워지게 두지 않는다.
 *
 * `window.confirm` 을 쓰지 않는다 — 브라우저 모달은 자동화 도구에서 세션을 멈추게 한다.
 */
export function ProjectSettingsPanel({
  workspaceSlug,
  project,
  impact,
}: {
  workspaceSlug: string;
  project: { slug: string; name: string; description: string | null };
  impact: ProjectDeletionImpact;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const form = useForm<CreateProjectFormValues, unknown, CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: project.name,
      slug: project.slug,
      description: project.description ?? "",
    },
  });

  async function onSave(values: CreateProjectInput) {
    setFailure(null);

    const result = await updateProjectAction(
      { workspaceSlug, projectSlug: project.slug },
      values,
    );

    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }

    // slug 가 바뀌었으면 지금 주소는 더 이상 이 Project 가 아니다.
    router.replace(`/w/${workspaceSlug}/p/${result.data.slug}/settings`);
  }

  async function onDelete() {
    setDeleting(true);
    setFailure(null);

    const result = await deleteProjectAction({
      workspaceSlug,
      projectSlug: project.slug,
    });

    setDeleting(false);

    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }

    setDeleteOpen(false);
    router.push(`/w/${workspaceSlug}/projects`);
  }

  const total =
    impact.repositories +
    impact.reviewSessions +
    impact.reviewIssues +
    impact.knowledgePages;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 pt-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" htmlFor="project-settings-name">
            이름
          </label>
          <Input
            id="project-settings-name"
            className="max-w-md"
            {...form.register("name")}
          />
          {form.formState.errors.name !== undefined && (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" htmlFor="project-settings-slug">
            slug
          </label>
          <Input
            id="project-settings-slug"
            className="max-w-md font-mono"
            {...form.register("slug")}
          />
          <p className="text-[11px] text-muted-foreground">
            바꾸면 이 Project 의 주소가 모두 바뀝니다.
          </p>
          {form.formState.errors.slug !== undefined && (
            <p className="text-xs text-destructive">
              {form.formState.errors.slug.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-xs font-medium"
            htmlFor="project-settings-description"
          >
            설명
          </label>
          <Textarea
            id="project-settings-description"
            rows={2}
            className="max-w-md"
            {...form.register("description")}
          />
        </div>

        {failure !== null && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}

        <div>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "저장 중" : "저장"}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-xs font-medium">Project 삭제</p>
        <p className="text-[11px] text-muted-foreground">
          Repository {impact.repositories} · Review {impact.reviewSessions} · Issue{" "}
          {impact.reviewIssues} · 문서 {impact.knowledgePages} 이 함께 사라집니다.
          {impact.repositories > 0 &&
            " Repository 를 살리려면 먼저 다른 Project 로 옮기세요."}
        </p>

        <Dialog
          open={deleteOpen}
          onOpenChange={(open) => {
            setDeleteOpen(open);
            if (!open) {
              setConfirmName("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="w-fit">
              삭제
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-sm">
                {project.name} 을(를) 삭제합니다
              </DialogTitle>
              <DialogDescription>
                {total === 0
                  ? "이 Project 에는 아직 아무것도 없습니다."
                  : `Repository ${impact.repositories} · Review ${impact.reviewSessions} · Issue ${impact.reviewIssues} · 문서 ${impact.knowledgePages} 이 함께 지워집니다.`}{" "}
                되돌릴 수 없습니다.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1">
              <label className="text-xs" htmlFor="confirm-project-name">
                확인을 위해 <span className="font-medium">{project.name}</span> 을(를)
                입력하세요
              </label>
              <Input
                id="confirm-project-name"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
              >
                취소
              </Button>
              <Button
                size="sm"
                onClick={onDelete}
                disabled={deleting || confirmName !== project.name}
              >
                {deleting ? "삭제 중" : "삭제"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
