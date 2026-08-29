"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Spinner } from "@/components/atoms/Spinner";
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
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * Project 생성 폼.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다(CLAUDE.md 8).
 * 검증 규칙은 Schema 에 있다 — 여기에 `if` 로 다시 적지 않는다.
 *
 * 만들고 나면 그 Project 로 옮겨 간다. 목록을 여기서 다시 불러오지 않는다 —
 * Server Action 의 `revalidatePath` 가 서버에 다시 그리게 한다.
 */
/** 🔴 이 Dialog 가 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface CreateProjectLabels {
  trigger: string;
  title: string;
  description: string;
  name: string;
  slug: string;
  optional: string;
  slugPlaceholder: string;
  slugHint: string;
  descriptionField: string;
  submit: string;
  submitting: string;
}

export function CreateProjectDialog({
  workspaceSlug,
  labels,
}: {
  workspaceSlug: string;
  labels: CreateProjectLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const form = useLocalizedForm<
    CreateProjectFormValues,
    unknown,
    CreateProjectInput
  >(createProjectSchema, {
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
        <Button size="sm">{labels.trigger}</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <form
          id="create-project"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" htmlFor="project-name">
              {labels.name}
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
              {labels.slug}{" "}
              <span className="text-muted-foreground">{labels.optional}</span>
            </label>
            <Input
              id="project-slug"
              placeholder={labels.slugPlaceholder}
              {...form.register("slug")}
            />
            <p className="text-[11px] text-muted-foreground">{labels.slugHint}</p>
            {form.formState.errors.slug !== undefined && (
              <p className="text-xs text-destructive">
                {form.formState.errors.slug.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" htmlFor="project-description">
              {labels.descriptionField}{" "}
              <span className="text-muted-foreground">{labels.optional}</span>
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
            {/* 🔴 label 을 갈아 끼우지 않는다 — 무엇을 실행 중인지가 계속 보여야 한다. */}
            {form.formState.isSubmitting && <Spinner />}
            {labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
