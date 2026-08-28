"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createKnowledgePageAction,
  updateKnowledgePageAction,
} from "@/features/knowledge/actions/knowledge-page-actions";
import {
  knowledgePageSchema,
  type KnowledgePageFormValues,
  type KnowledgePageInput,
} from "@/features/knowledge/schemas/knowledge-page";

/**
 * Wiki 문서 작성·수정 폼.
 *
 * 사용자 입력이 있는 폼이라 CSR + React Hook Form 이고, 제출은 Server Action 이다(CLAUDE.md 8).
 * 검증 규칙은 Schema 에 있다 — 여기에 `if` 로 다시 적지 않는다.
 *
 * 🔴 **Scope 를 여기서 정하지 않는다.** 이 Component 가 넘기는 것은 주소의 slug 뿐이고,
 * 실제 `workspaceId`·`projectId` 는 Server Action 이 소속을 확인해 얻는다(CLAUDE.md 11).
 */
export function KnowledgePageForm({
  workspaceSlug,
  projectSlug,
  listPath,
  current,
}: {
  workspaceSlug: string;
  /** `null` 이면 Workspace Knowledge. */
  projectSlug: string | null;
  /** 저장한 뒤 돌아갈 목록 주소. */
  listPath: Route;
  /** 수정이면 현재 값, 새로 쓰는 것이면 `null`. */
  current: { slug: string; title: string; content: string } | null;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<KnowledgePageFormValues, unknown, KnowledgePageInput>({
    resolver: zodResolver(knowledgePageSchema),
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

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4 p-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="knowledge-title">
          제목
        </label>
        <Input
          id="knowledge-title"
          placeholder="예: Transaction 경계 규칙"
          {...form.register("title")}
        />
        {form.formState.errors.title !== undefined && (
          <p className="text-xs text-destructive">
            {form.formState.errors.title.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="knowledge-slug">
          slug <span className="text-muted-foreground">(선택)</span>
        </label>
        <Input
          id="knowledge-slug"
          placeholder="비워 두면 제목에서 만듭니다"
          {...form.register("slug")}
        />
        {form.formState.errors.slug !== undefined && (
          <p className="text-xs text-destructive">
            {form.formState.errors.slug.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="knowledge-content">
          본문 <span className="text-muted-foreground">(Markdown)</span>
        </label>
        <Textarea
          id="knowledge-content"
          rows={20}
          className="font-mono text-xs"
          {...form.register("content")}
        />
        {form.formState.errors.content !== undefined && (
          <p className="text-xs text-destructive">
            {form.formState.errors.content.message}
          </p>
        )}
      </div>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "저장 중" : "저장"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => router.push(listPath)}
        >
          취소
        </Button>
      </div>
    </form>
  );
}
