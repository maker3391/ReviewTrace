"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Spinner } from "@/components/atoms/Spinner";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/ui/button";
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
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

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
/** 🔴 이 화면이 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface ProjectSettingsLabels {
  name: string;
  slug: string;
  slugHint: string;
  description: string;
  save: string;
  deleteTitle: string;
  deleteImpact: string;
  deleteRescue: string;
  deleteDialogTitle: string;
  deleteDialogImpact: string;
  irreversible: string;
  confirmPrefix: string;
  confirmSuffix: string;
  delete: string;
  cancel: string;
}

export function ProjectSettingsPanel({
  workspaceSlug,
  project,
  impact,
  labels,
}: {
  workspaceSlug: string;
  project: { slug: string; name: string; description: string | null };
  impact: ProjectDeletionImpact;
  labels: ProjectSettingsLabels;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const form = useLocalizedForm<
    CreateProjectFormValues,
    unknown,
    CreateProjectInput
  >(createProjectSchema, {
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
    const result = await deleteProjectAction({
      workspaceSlug,
      projectSlug: project.slug,
    });

    if (result.ok) {
      router.push(`/w/${workspaceSlug}/projects`);
    }

    // 실패 사유는 Dialog 가 제 안에 그린다 — 뒤에 가려진 폼으로 보내지 않는다.
    return result;
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 pt-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" htmlFor="project-settings-name">
            {labels.name}
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
            {labels.slug}
          </label>
          <Input
            id="project-settings-slug"
            className="max-w-md font-mono"
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
          <label
            className="text-xs font-medium"
            htmlFor="project-settings-description"
          >
            {labels.description}
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
            {/* 🔴 label 을 갈아 끼우지 않는다 — 무엇을 실행 중인지가 계속 보여야 한다. */}
            {form.formState.isSubmitting && <Spinner />}
            {labels.save}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-xs font-medium">{labels.deleteTitle}</p>
        <p className="text-[11px] text-muted-foreground">
          {labels.deleteImpact}
          {impact.repositories > 0 && labels.deleteRescue}
        </p>

        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => setDeleteOpen(true)}
        >
          {labels.delete}
        </Button>

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            setDeleteOpen(open);
            if (!open) {
              setConfirmName("");
            }
          }}
          title={labels.deleteDialogTitle}
          description={
            <>
              {labels.deleteDialogImpact} {labels.irreversible}
            </>
          }
          actionLabel={labels.delete}
          cancelLabel={labels.cancel}
          /* 🔴 이름을 그대로 적기 전에는 실행되지 않는다 — 확인 버튼 하나로 지워지게 두지 않는다. */
          confirmDisabled={confirmName !== project.name}
          onConfirm={onDelete}
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs" htmlFor="confirm-project-name">
              {labels.confirmPrefix}
              <span className="font-medium">{project.name}</span>
              {labels.confirmSuffix}
            </label>
            <Input
              id="confirm-project-name"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </div>
        </ConfirmDialog>
      </div>
    </div>
  );
}
