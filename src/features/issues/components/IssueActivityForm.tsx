"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

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
import {
  issueActivityFormSchema,
  MANUAL_ACTIVITY_TYPES,
  type IssueActivityFormInput,
  type IssueActivityFormValues,
} from "@/features/issues/schemas/issue-form";

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
export function IssueActivityForm({
  workspaceSlug,
  projectSlug,
  issueId,
}: {
  workspaceSlug: string;
  projectSlug: string;
  issueId: string;
}) {
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<IssueActivityFormValues, unknown, IssueActivityFormInput>(
    {
      resolver: zodResolver(issueActivityFormSchema),
      defaultValues: { type: "COMMENT", description: "", commitSha: "" },
    },
  );

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
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Activity
          </span>
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-8 w-48" aria-label="Activity Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_ACTIVITY_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Commit <span className="font-normal">(선택)</span>
          </span>
          <Input
            aria-label="Commit SHA"
            placeholder="a81f3c2"
            className="h-8 w-44 font-mono text-xs"
            {...form.register("commitSha")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="issue-activity-description">
          내용 <span className="text-muted-foreground">(선택)</span>
        </label>
        <Textarea
          id="issue-activity-description"
          rows={3}
          className="text-xs"
          placeholder="무엇을 했는지 — 다음에 같은 문제를 만났을 때 읽을 사람을 위해"
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
          {form.formState.isSubmitting ? "남기는 중" : "기록 남기기"}
        </Button>
      </div>
    </form>
  );
}
