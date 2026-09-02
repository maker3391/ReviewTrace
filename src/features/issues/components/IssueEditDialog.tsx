"use client";

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
import { updateIssueContentAction } from "@/features/issues/actions/issue-actions";
import {
  issueEditSchema,
  type IssueEditInput,
  type IssueEditValues,
} from "@/features/issues/schemas/issue-edit";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * 사람이 Issue 의 **서술**을 다듬는 자리.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다.
 * 🔴 **검증 규칙을 여기에 `if` 로 적지 않는다** — Server Action 이 쓰는 Schema 를 그대로
 * resolver 로 쓴다(`schemas/issue-edit.ts`).
 *
 * ## 🔴 Markdown 은 **원문 그대로** 오간다
 *
 * 화면이 그리는 것은 `MarkdownContent` 가 렌더한 결과지만, 이 폼이 들고 있는 것은
 * **저장된 Markdown 문자열 그 자체**다. WYSIWYG 로 바꿔 담았다가 다시 적어 내려놓으면
 * 표·각주·줄바꿈 같은 것이 왕복 한 번에 어긋난다 — 그래서 `Textarea` 에 원문을 그대로
 * 넣고, 나가는 값도 그 문자열이다(앞뒤 공백만 Schema 가 다듬는다).
 * 그 원문이 Agent 가 다시 읽어 갈 Knowledge 이기도 하다.
 *
 * ## 여기 없는 칸
 *
 * 🔴 **해결 요약은 이 폼에 없다.** 그 칸은 상태·`resolvedAt`·History 와 한 몸이라
 * 상태 자리의 「요약 수정」이 상태 전이를 거쳐 함께 움직인다(`IssueStatusControl`).
 * 🔴 **Severity·Category·위치·출처도 없다** — 이유는 `schemas/issue-edit.ts` 에 있다.
 */
/** 🔴 이 Dialog 가 실제로 그리는 낱말만 받는다. */
export interface IssueEditLabels {
  trigger: string;
  title: string;
  description: string;
  issueTitle: string;
  optional: string;
  markdownHint: string;
  issueDescription: string;
  rootCause: string;
  failurePath: string;
  suggestion: string;
  cancel: string;
  submit: string;
}

export function IssueEditDialog({
  workspaceSlug,
  projectSlug,
  issueId,
  issue,
  labels,
}: {
  workspaceSlug: string;
  projectSlug: string;
  issueId: string;
  /** 🔴 화면에 필요한 칸만 내려온다. Issue 전체를 Client 로 넘기지 않는다. */
  issue: {
    title: string;
    description: string | null;
    rootCause: string | null;
    failurePath: string | null;
    suggestion: string | null;
  };
  labels: IssueEditLabels;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /*
 🔴 `defaultValues` 가 아니라 `values` 다. 저장하면 서버가 이 화면을 다시 그리는데,
 `defaultValues` 는 그때 갱신되지 않아 폼이 「저장 전 원문」을 계속 들고 있게 된다 —
 `IssueStatusControl` 이 같은 이유로 `values` 를 쓴다.

 🔴 없는 값은 빈 문자열이다. `null` 을 그대로 넣으면 React 가 uncontrolled input 경고를
 내고, 사용자가 지운 칸과 처음부터 비어 있던 칸이 구분되지 않는다 — Schema 가 나갈 때
 다시 `null` 로 모은다.
 */
  const form = useLocalizedForm<IssueEditValues, unknown, IssueEditInput>(
    issueEditSchema,
    {
      values: {
        title: issue.title,
        description: issue.description ?? "",
        rootCause: issue.rootCause ?? "",
        failurePath: issue.failurePath ?? "",
        suggestion: issue.suggestion ?? "",
      },
    },
  );

  async function onSubmit(values: IssueEditInput) {
    setFailure(null);

    const result = await updateIssueContentAction(
      { workspaceSlug, projectSlug, issueId },
      values,
    );

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다.
      setFailure(result.error.message);
      return;
    }

    // 저장 결과는 revalidate 된 Server Component props 로 다시 들어온다.
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        /*
 🔴 **저장 중에는 닫지 않는다.** 요청은 이미 서버로 갔는데 화면만 사라지면
 사용자는 그것이 됐는지 알 방법이 없다 — `ConfirmDialog` 와 같은 판단이다.
 */
        if (form.formState.isSubmitting) {
          return;
        }
        setOpen(next);
        if (!next) {
          setFailure(null);
          // 🔴 되돌리는 자리는 «지금 저장된 값»이다. `values` 가 그것을 들고 있다.
          form.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        {/*
 🔴 Primary 로 두지 않는다. 이 화면에서 사람이 주로 하는 일은 상태를 옮기고
 History 를 남기는 것이고, 문장을 다듬는 것은 그 곁에 있는 일이다.
 */}
        <Button size="sm" variant="outline">
          {labels.trigger}
        </Button>
      </DialogTrigger>

      {/*
 🔴 기본 폭(`sm:max-w-sm`)은 Markdown 원문을 담기에 좁다 — 한 줄이 20자 남짓으로
 접혀 무엇을 고치는지 읽히지 않는다. 세로로도 넘칠 수 있어 안에서 스크롤한다.
 */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <form
          id="edit-issue"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" htmlFor="issue-edit-title">
              {labels.issueTitle}
            </label>
            <Input id="issue-edit-title" {...form.register("title")} />
            {form.formState.errors.title !== undefined && (
              <p className="text-xs text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          {/*
 🔴 네 칸을 한 덩어리로 묶는다. 전부 같은 성격(Markdown 서술)이라, 안내를 칸마다
 되풀이하지 않고 묶음 머리에 한 번만 둔다 — 같은 크기의 박스를 다섯 개 늘어놓지 않는다.
 */}
          <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
            <p className="text-[11px] text-muted-foreground">
              {labels.markdownHint}
            </p>

            <NarrativeField
              name="description"
              label={labels.issueDescription}
              optional={labels.optional}
              form={form}
            />
            <NarrativeField
              name="rootCause"
              label={labels.rootCause}
              optional={labels.optional}
              form={form}
            />
            <NarrativeField
              name="failurePath"
              label={labels.failurePath}
              optional={labels.optional}
              form={form}
            />
            <NarrativeField
              name="suggestion"
              label={labels.suggestion}
              optional={labels.optional}
              form={form}
            />
          </div>

          {failure !== null && (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={form.formState.isSubmitting}
          >
            {labels.cancel}
          </Button>
          <Button
            type="submit"
            form="edit-issue"
            size="sm"
            disabled={form.formState.isSubmitting || !form.formState.isDirty}
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

/**
 * Markdown 서술 한 칸.
 *
 * 🔴 **원문을 그대로 보여 준다** — `font-mono` 는 장식이 아니라, 들여쓰기·표·코드블록이
 * 눈으로 맞아떨어져야 사람이 Markdown 을 고칠 수 있기 때문이다.
 */
function NarrativeField({
  name,
  label,
  optional,
  form,
}: {
  name: "description" | "rootCause" | "failurePath" | "suggestion";
  label: string;
  optional: string;
  form: ReturnType<
    typeof useLocalizedForm<IssueEditValues, unknown, IssueEditInput>
  >;
}) {
  const error = form.formState.errors[name];

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" htmlFor={`issue-edit-${name}`}>
        {label} <span className="text-muted-foreground">{optional}</span>
      </label>
      <Textarea
        id={`issue-edit-${name}`}
        rows={6}
        className="font-mono text-xs leading-relaxed"
        {...form.register(name)}
      />
      {error !== undefined && (
        <p className="text-xs text-destructive">{error.message}</p>
      )}
    </div>
  );
}
