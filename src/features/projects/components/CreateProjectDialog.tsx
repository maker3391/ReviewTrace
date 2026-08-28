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
import { createProjectAction } from "@/features/projects/actions/create-project";
import {
  createProjectSchema,
  type CreateProjectFormValues,
  type CreateProjectInput,
} from "@/features/projects/schemas/project";

/**
 * Project 생성 폼.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다(CLAUDE.md 8).
 * 검증 규칙은 Schema 에 있다 — 여기에 `if` 로 다시 적지 않는다.
 *
 * 만들고 나면 그 Project 로 옮겨 간다. 목록을 여기서 다시 불러오지 않는다 —
 * Server Action 의 `revalidatePath` 가 서버에 다시 그리게 한다.
 */
export function CreateProjectDialog({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<CreateProjectFormValues, unknown, CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  async function onSubmit(values: CreateProjectInput) {
    setFailure(null);

    const result = await createProjectAction(workspaceSlug, values);

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다(CLAUDE.md 19).
      setFailure(result.error.message);
      return;
    }

    setOpen(false);
    form.reset();
    router.push(`/w/${workspaceSlug}/p/${result.data.slug}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFailure(null);
          form.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Project 만들기</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">Project 만들기</DialogTitle>
          <DialogDescription>
            하나의 제품 또는 업무 단위입니다. Repository 는 이 아래에 붙습니다.
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-project"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" htmlFor="project-name">
              이름
            </label>
            <Input
              id="project-name"
              placeholder="SMIL"
              {...form.register("name")}
            />
            {form.formState.errors.name !== undefined && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" htmlFor="project-slug">
              slug <span className="text-muted-foreground">(선택)</span>
            </label>
            <Input
              id="project-slug"
              placeholder="비워 두면 이름에서 만듭니다"
              {...form.register("slug")}
            />
            <p className="text-[11px] text-muted-foreground">
              주소에 쓰입니다 — /w/{workspaceSlug}/p/&#123;slug&#125;
            </p>
            {form.formState.errors.slug !== undefined && (
              <p className="text-xs text-destructive">
                {form.formState.errors.slug.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" htmlFor="project-description">
              설명 <span className="text-muted-foreground">(선택)</span>
            </label>
            <Textarea
              id="project-description"
              rows={2}
              {...form.register("description")}
            />
            {form.formState.errors.description !== undefined && (
              <p className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          {failure !== null && (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button
            type="submit"
            form="create-project"
            size="sm"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "만드는 중" : "만들기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
