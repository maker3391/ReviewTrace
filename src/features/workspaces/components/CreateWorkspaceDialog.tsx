"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

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
import { createWorkspaceAction } from "@/features/workspaces/actions/workspace-actions";
import {
  createWorkspaceSchema,
  type CreateWorkspaceInput,
} from "@/features/workspaces/schemas/workspace";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * Workspace 만들기.
 *
 * 🔴 **Personal Workspace 를 만드는 자리와 다르다.** 저쪽은 가입이 자동으로 부르는 것이고
 * 이것은 사람이 누르는 것이다 — 만든 사람이 OWNER 가 되고, 기존 소속은 그대로 남는다.
 *
 * 만들고 나면 그 Workspace 로 옮겨 간다. Switcher 목록은 Server Action 의
 * `revalidatePath(.., "layout")` 이 서버에서 다시 그린다.
 */
/** 🔴 이 Dialog 가 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface CreateWorkspaceLabels {
  title: string;
  description: string;
  name: string;
  submit: string;
  submitting: string;
}

export function CreateWorkspaceDialog({
  trigger,
  labels,
}: {
  trigger: ReactNode;
  labels: CreateWorkspaceLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const form = useLocalizedForm<CreateWorkspaceInput>(createWorkspaceSchema, {
    defaultValues: { name: "" },
  });

  async function onSubmit(values: CreateWorkspaceInput) {
    setFailure(null);

    const result = await createWorkspaceAction(values);

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다(CLAUDE.md 19).
      setFailure(result.error.message);
      return;
    }

    setOpen(false);
    form.reset();
    router.push(`/w/${result.data.slug}/dashboard`);
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <form
          id="create-workspace"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-1"
        >
          <label className="text-xs font-medium" htmlFor="workspace-name">
            {labels.name}
          </label>
          <Input
            id="workspace-name"
            placeholder="CodeApex"
            {...form.register("name")}
          />
          {form.formState.errors.name !== undefined && (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
          {failure !== null && (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button
            type="submit"
            form="create-workspace"
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
