"use client";

import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";

import { Spinner } from "@/components/atoms/Spinner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateIssueStatusAction } from "@/features/issues/actions/issue-actions";
import { MarkdownContent } from "@/features/issues/components/MarkdownContent";
import type {
  IssueStatusFormInput,
  IssueStatusFormValues,
} from "@/features/issues/schemas/issue-form";
import { issueStatusUpdateSchema } from "@/features/issues/schemas/issue-status-update";
import { ISSUE_STATUSES, type IssueStatus } from "@/types/review";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * 사람이 Issue 상태를 바꾸는 자리.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다.
 *
 * 🔴 **검증 규칙을 여기에 `if` 로 적지 않는다.** Agent API 가 쓰는 Schema 를 그대로 resolver
 * 로 쓴다 — 「RESOLVED 에는 해결 요약이 필요하다」는 그 Schema 가 말한다.
 *
 * 🔴 **누가 바꿨는지를 보내지 않는다.** Server Action 이 세션에서 읽는다 — 화면이 적어 보내면
 * 남의 이름으로 History 를 남길 수 있다.
 */
/** 🔴 이 폼이 실제로 그리는 낱말만 받는다. */
export interface IssueStatusLabels {
  status: string;
  changeStatus: string;
  changing: string;
  resolutionSummary: string;
  editResolutionSummary: string;
  cancelResolutionSummary: string;
  saveResolutionSummary: string;
  emptyResolutionSummary: string;
  /** 🔴 값의 이름표. Select 의 `value` 는 `IssueStatus` 그대로다. */
  statusOptions: Record<IssueStatus, string>;
}

export function IssueStatusControl({
  workspaceSlug,
  projectSlug,
  issueId,
  currentStatus,
  currentResolutionSummary,
  labels,
}: {
  workspaceSlug: string;
  projectSlug: string;
  issueId: string;
  currentStatus: IssueStatus;
  currentResolutionSummary: string | null;
  labels: IssueStatusLabels;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [editingResolutionSummary, setEditingResolutionSummary] =
    useState(false);

  const form = useLocalizedForm<
    IssueStatusFormValues,
    unknown,
    IssueStatusFormInput
  >(issueStatusUpdateSchema, {
    /*
 🔴 `defaultValues` 가 아니라 `values` 다. 상태를 바꾸면 서버가 이 화면을 다시 그리는데,
 `defaultValues` 는 그때 갱신되지 않아 폼이 「방금 떠난 상태」를 계속 들고 있게 된다.
 */
    values: {
      status: currentStatus,
      resolutionSummary: currentResolutionSummary ?? "",
    },
  });

  /*
 🔴 `form.watch()` 로 값을 읽지 않는다 — 매 렌더마다 새 함수를 돌려줘 메모이제이션이
 깨진다(React Compiler 가 이 Component 를 통째로 건너뛴다). 구독은 `useWatch` 로 한다.
 */
  const status = useWatch({ control: form.control, name: "status" });
  const showResolutionEditor =
    status === "RESOLVED" &&
    (editingResolutionSummary ||
      currentStatus !== "RESOLVED" ||
      currentResolutionSummary === null);
  const editingExistingSummary =
    status === "RESOLVED" &&
    currentStatus === "RESOLVED" &&
    editingResolutionSummary;

  async function onSubmit(values: IssueStatusFormInput) {
    setFailure(null);

    const result = await updateIssueStatusAction(
      { workspaceSlug, projectSlug, issueId },
      // 🔴 actor 는 보내지 않는다. Schema 가 선택 값으로 두고 있어도 서버가 세션으로 채운다.
      {
        status: values.status,
        /**
         * 🔴 **RESOLVED 가 아니면 요약을 보내지 않는다.**
         *
         * 요약 칸은 RESOLVED 일 때만 «보이지만», 값은 폼 상태에 남는다. 그대로 보내면
         * `issue-status-service` 가 그것을 Activity 의 `description` 으로 적어
         * 「REOPENED 했다」 옆에 지난 해결 요약이 붙는다 — History 가 거짓이 된다.
         *
         * 실제로 브라우저에서 REOPENED 를 눌러 보고 잡은 것이다.
         */
        resolutionSummary:
          values.status === "RESOLVED" ? values.resolutionSummary : null,
      },
    );

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다.
      setFailure(result.error.message);
      return;
    }

    // 저장 결과는 revalidate 된 Server Component props로 다시 들어온다. 기존 요약을
    // 편집하던 경우에는 로컬 편집 상태도 닫아 조회용 Markdown 문서로 돌아간다.
    setEditingResolutionSummary(false);
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-3 pt-3"
    >
      {/* 곁 열(20rem)과 좁은 화면 둘 다에서 버튼이 밀려나지 않게 줄바꿈을 허용한다 —
 `IssueActivityForm` 과 같은 이유다. 들어가는 폭에서는 지금과 똑같이 한 줄이다. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {labels.status}
          </span>
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-8 w-44" aria-label={labels.status}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {labels.statusOptions[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        {!editingExistingSummary && (
          <Button
            type="submit"
            size="sm"
            /*
 같은 상태로 다시 바꾸면 History 에 뜻 없는 한 줄이 남는다 —
 모든 전이가 Activity 를 남기기 때문이다(`issue-status-service.ts`).
 */
            disabled={form.formState.isSubmitting || !form.formState.isDirty}
          >
            {/* 같은 전이 안에서도 상태 변경과 요약 저장은 서로 다른 작업으로 읽혀야 한다. */}
            {form.formState.isSubmitting && <Spinner />}
            {status === currentStatus && showResolutionEditor
              ? labels.saveResolutionSummary
              : labels.changeStatus}
          </Button>
        )}
      </div>

      {/*
 🔴 RESOLVED 일 때만 보인다. 다른 상태로 가면 Service 가 해결 요약을 `null` 로 지우므로,
 입력칸을 계속 두면 「적었는데 사라진」 것이 된다 — 화면이 저장 결과와 어긋난다.
 */}
      {status === "RESOLVED" && (
        <div className="flex flex-col gap-1">
          {showResolutionEditor ? (
            <>
              <label
                className="text-xs font-medium"
                htmlFor="issue-resolution-summary"
              >
                {labels.resolutionSummary}
              </label>
              <Textarea
                id="issue-resolution-summary"
                rows={8}
                className="font-mono text-xs leading-relaxed"
                {...form.register("resolutionSummary")}
              />
              {form.formState.errors.resolutionSummary !== undefined && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.resolutionSummary.message}
                </p>
              )}
              {editingExistingSummary && (
                <div className="mt-1 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      form.resetField("resolutionSummary", {
                        defaultValue: currentResolutionSummary ?? "",
                      });
                      setEditingResolutionSummary(false);
                    }}
                  >
                    {labels.cancelResolutionSummary}
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      form.formState.isSubmitting || !form.formState.isDirty
                    }
                  >
                    {form.formState.isSubmitting && <Spinner />}
                    {labels.saveResolutionSummary}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-md border border-border/70 bg-surface-muted/25 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium">
                  {labels.resolutionSummary}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  aria-expanded={false}
                  onClick={() => setEditingResolutionSummary(true)}
                >
                  {labels.editResolutionSummary}
                </Button>
              </div>
              <MarkdownContent
                content={currentResolutionSummary ?? ""}
                emptyLabel={labels.emptyResolutionSummary}
                className="gap-2 [&_p]:text-xs"
              />
            </div>
          )}
        </div>
      )}

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
    </form>
  );
}
