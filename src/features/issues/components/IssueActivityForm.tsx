"use client";

import { useState } from "react";
import { Controller } from "react-hook-form";

import { Spinner } from "@/components/atoms/Spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addIssueActivityAction } from "@/features/issues/actions/issue-actions";
import type { IssueActivityType } from "@/types/review";
import {
  issueActivityFormSchema,
  MANUAL_ACTIVITY_TYPES,
  type IssueActivityFormInput,
  type IssueActivityFormValues,
} from "@/features/issues/schemas/issue-form";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * 사람이 Issue History 에 한 줄 남기는 자리.
 *
 * 이 화면의 주인공은 History 다(CLAUDE.md 2). 지금까지는 Agent 만 기록을 남길 수 있었는데,
 * 사람이 손으로 확인한 것(「다시 봤다」·「이렇게 고쳐 봤다」)이 빠지면 **Knowledge 에
 * 사람이 한 일만 통째로 비어 있게** 된다.
 *
 * 🔴 **고를 수 있는 Type 은 상태를 바꾸지 않는 것뿐이다**(`MANUAL_ACTIVITY_TYPES`).
 * 상태를 바꾸는 기록은 상태 전이가 남긴다 — 여기서 손으로 남기면 상태와 History 가 어긋난다.
 */
/** 🔴 이 폼이 실제로 그리는 낱말만 받는다(CLAUDE.md 11). */
export interface IssueActivityLabels {
  activity: string;
  activityType: string;
  commit: string;
  commitSha: string;
  optional: string;
  description: string;
  recording: string;
  record: string;
  /** 🔴 값의 이름표. Select 의 `value` 는 `IssueActivityType` 그대로다. */
  typeOptions: Record<IssueActivityType, string>;
}

export function IssueActivityForm({
  workspaceSlug,
  projectSlug,
  issueId,
  labels,
}: {
  workspaceSlug: string;
  projectSlug: string;
  issueId: string;
  labels: IssueActivityLabels;
}) {
  const [failure, setFailure] = useState<string | null>(null);

  const form = useLocalizedForm<
    IssueActivityFormValues,
    unknown,
    IssueActivityFormInput
  >(issueActivityFormSchema, {
    defaultValues: { type: "COMMENT", description: "", commitSha: "" },
  });

  async function onSubmit(values: IssueActivityFormInput) {
    setFailure(null);

    const result = await addIssueActivityAction(
      { workspaceSlug, projectSlug, issueId },
      values,
    );

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다(CLAUDE.md 19).
      setFailure(result.error.message);
      return;
    }

    // History 는 서버가 다시 그린다. 입력칸만 비운다.
    form.reset();
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-3 pt-3"
    >
      {/*
        🔴 **`w-48` + `w-44` = 376px 은 이 폼이 서는 자리보다 넓다.**
        Issue 상세는 1024px 부터 본문이 `minmax(0,1fr)` 로 좁아져 실측 363px 이고,
        그 Section 은 `overflow-hidden` 이라 넘친 커밋 칸이 **스크롤도 없이 잘렸다**.
        390px 에서는 페이지 자체가 좌우로 넘쳤다. 줄바꿈을 허용해 두 칸이 아래위로
        놓이게 한다 — 각 칸은 그 폭에 그대로 들어간다.
      */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {labels.activity}
          </span>
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-8 w-48" aria-label={labels.activityType}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_ACTIVITY_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {labels.typeOptions[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {labels.commit} <span className="font-normal">{labels.optional}</span>
          </span>
          <Input
            aria-label={labels.commitSha}
            placeholder="a81f3c2"
            className="h-8 w-44 font-mono text-xs"
            {...form.register("commitSha")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="issue-activity-description">
          {labels.description} <span className="text-muted-foreground">{labels.optional}</span>
        </label>
        <Textarea
          id="issue-activity-description"
          rows={3}
          className="text-xs"
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

      <div>
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {/* 🔴 label 을 갈아 끼우지 않는다 — 무엇을 실행 중인지가 계속 보여야 한다. */}
          {form.formState.isSubmitting && <Spinner />}
          {labels.record}
        </Button>
      </div>
    </form>
  );
}
