"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { Controller } from "react-hook-form";

import { Spinner } from "@/components/atoms/Spinner";
import {
  MarkdownEditor,
  type MarkdownEditorLabels,
} from "@/components/molecules/MarkdownEditor";
import { PageHeader } from "@/components/molecules/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createKnowledgePageAction,
  updateKnowledgePageAction,
} from "@/features/knowledge/actions/knowledge-page-actions";
import {
  knowledgePageSchema,
  type KnowledgePageFormValues,
  type KnowledgePageInput,
} from "@/features/knowledge/schemas/knowledge-page";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * Wiki 문서 작성·수정 폼.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다(CLAUDE.md 8).
 * 검증 규칙은 Schema 에 있다 — 여기에 `if` 로 다시 적지 않는다.
 *
 * 🔴 **Scope 를 여기서 정하지 않는다.** 이 Component 가 넘기는 것은 주소의 slug 뿐이고,
 * 실제 `workspaceId`·`projectId` 는 Server Action 이 소속을 확인해 얻는다(CLAUDE.md 11).
 *
 * ## 🔴 세 칸을 같은 크기로 늘어놓지 않는다
 *
 * 제목 · slug · 본문은 **같은 무게가 아니다.** 셋을 똑같은 상자로 쌓으면 「DB 행 하나를
 * 더하는 관리자 폼」이 되고, 정작 오래 머무는 본문이 세 줄짜리 칸으로 남는다.
 *
 * ```
 * 문서 제목        <- 이 문서가 무엇인가 (가장 큼)
 * Slug            <- 주소를 손보고 싶을 때만 (곁 정보)
 * 본문 Editor      <- 실제로 일하는 자리 (화면의 대부분)
 * ```
 *
 * 저장·취소는 **머리글 오른쪽**에 둔다 — 본문이 화면을 채우고 나면 폼 맨 아래에 있는
 * 버튼은 스크롤 밖으로 밀린다.
 */

/** 이 화면이 그리는 낱말. 🔴 사전 전체를 넘기지 않는다(CLAUDE.md 11). */
export interface KnowledgePageFormLabels {
  newTitle: string;
  editTitle: string;
  backToList: string;
  save: string;
  saving: string;
  cancel: string;
  titleLabel: string;
  titlePlaceholder: string;
  slugLabel: string;
  slugPlaceholder: string;
  slugHint: string;
  contentLabel: string;
  contentPlaceholder: string;
  editor: MarkdownEditorLabels;
}

export function KnowledgePageForm({
  workspaceSlug,
  projectSlug,
  listPath,
  current,
  labels,
}: {
  workspaceSlug: string;
  /** `null` 이면 Workspace Knowledge. */
  projectSlug: string | null;
  /** 저장한 뒤 돌아갈 목록 주소. */
  listPath: Route;
  /** 수정이면 현재 값, 새로 쓰는 것이면 `null`. */
  current: { slug: string; title: string; content: string } | null;
  labels: KnowledgePageFormLabels;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useLocalizedForm<
    KnowledgePageFormValues,
    unknown,
    KnowledgePageInput
  >(knowledgePageSchema, {
    defaultValues: {
      title: current?.title ?? "",
      slug: current?.slug ?? "",
      content: current?.content ?? "",
    },
  });

  async function onSubmit(values: KnowledgePageInput) {
    setFailure(null);

    const result =
      current === null
        ? await createKnowledgePageAction(
            { workspaceSlug, projectSlug },
            values,
          )
        : await updateKnowledgePageAction(
            { workspaceSlug, projectSlug, currentSlug: current.slug },
            values,
          );

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다(CLAUDE.md 19).
      setFailure(result.error.message);
      return;
    }

    router.push(`${listPath}/${result.data.slug}` as Route);
  }

  const titleError = form.formState.errors.title;
  const slugError = form.formState.errors.slug;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
    >
      <PageHeader
        breadcrumb={{ label: labels.backToList, href: listPath }}
        title={current === null ? labels.newTitle : labels.editTitle}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => router.push(listPath)}
            >
              {labels.cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={form.formState.isSubmitting}
            >
              {/* 🔴 label 을 갈아 끼우지 않는다 — 무엇을 실행 중인지가 계속 보여야 한다. */}
              {form.formState.isSubmitting && <Spinner />}
              {labels.save}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-2 border-b border-border pb-4">
        {/*
          🔴 제목은 «상자»가 아니라 «문서의 제목»으로 보여야 한다. 테두리를 지우고 글자를
          키운다 — 다만 label 은 화면에서만 감추고 남겨 둔다(읽어 주는 도구는 그대로 읽는다).
        */}
        <label className="sr-only" htmlFor="knowledge-title">
          {labels.titleLabel}
        </label>
        <Input
          id="knowledge-title"
          placeholder={labels.titlePlaceholder}
          autoComplete="off"
          aria-invalid={titleError !== undefined}
          aria-describedby={
            titleError !== undefined ? "knowledge-title-error" : undefined
          }
          /* 🔴 `dark:bg-input/30` 까지 함께 지운다 — 그러지 않으면 어두운 화면에서만 상자가 남는다. */
          className="h-auto rounded-md border-0 bg-transparent px-0 py-0 text-2xl font-semibold tracking-[-0.015em] placeholder:text-muted-foreground/55 focus-visible:border-transparent focus-visible:ring-0 md:text-2xl dark:bg-transparent"
          {...form.register("title")}
        />
        {titleError !== undefined && (
          <p id="knowledge-title-error" className="text-xs text-destructive">
            {titleError.message}
          </p>
        )}

        {/* slug 는 제목과 동급이 아니다 — 한 줄에 눕혀 곁 정보로 둔다. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label
            className="text-[11px] font-medium text-muted-foreground"
            htmlFor="knowledge-slug"
          >
            {labels.slugLabel}
          </label>
          <Input
            id="knowledge-slug"
            placeholder={labels.slugPlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={slugError !== undefined}
            aria-describedby={
              slugError !== undefined ? "knowledge-slug-error" : "knowledge-slug-hint"
            }
            /*
              🔴 `min-w-40` 이 있어야 좁은 화면에서 slug 칸이 짓눌리는 대신 **설명이 다음
              줄로 내려간다.** 최소 폭이 없으면 셋이 한 줄에 억지로 끼어 글자가 잘린다.
            */
            className="h-7 w-auto min-w-40 max-w-64 flex-1 rounded-md bg-surface-muted/70 px-2 py-0 font-mono text-xs md:text-xs"
            {...form.register("slug")}
          />
          {/* 장식이 아니라 판단에 필요한 사실이다 — 비워 두면 무슨 일이 일어나는지 말한다. */}
          <span
            id="knowledge-slug-hint"
            className="text-[11px] text-muted-foreground"
          >
            {labels.slugHint}
          </span>
        </div>
        {slugError !== undefined && (
          <p id="knowledge-slug-error" className="text-xs text-destructive">
            {slugError.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {/*
          🔴 `contenteditable` 인 Editor 는 `<label for>` 가 걸리지 않는 요소다 —
          이름은 `aria-labelledby` 로 잇는다(`MarkdownEditor` 의 `labelledBy`).
        */}
        <label
          id="knowledge-content-label"
          className="sr-only"
          htmlFor="knowledge-content"
        >
          {labels.contentLabel}
        </label>
        <Controller
          control={form.control}
          name="content"
          render={({ field, fieldState }) => (
            <MarkdownEditor
              id="knowledge-content"
              value={field.value ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              placeholder={labels.contentPlaceholder}
              labels={labels.editor}
              labelledBy="knowledge-content-label"
              invalid={fieldState.error !== undefined}
              describedBy={
                fieldState.error !== undefined
                  ? "knowledge-content-error"
                  : undefined
              }
            />
          )}
        />
        {form.formState.errors.content !== undefined && (
          <p id="knowledge-content-error" className="text-xs text-destructive">
            {form.formState.errors.content.message}
          </p>
        )}
      </div>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
    </form>
  );
}
