"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  FilterSelectField,
  type FilterOption,
} from "@/components/molecules/FilterSelectField";
import { SearchField } from "@/components/molecules/SearchField";
import { Button } from "@/components/ui/button";
import {
  FILTER_ALL,
  issueFilterFormSchema,
  issueFilterToQueryString,
  type IssueFilter,
  type IssueFilterForm,
} from "@/features/issues/schemas/issue-filter";
import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
} from "@/types/review";

function toOptions(values: readonly string[], allLabel: string): FilterOption[] {
  return [
    { value: FILTER_ALL, label: allLabel },
    ...values.map((value) => ({ value, label: value })),
  ];
}

const SEVERITY_OPTIONS = toOptions(ISSUE_SEVERITIES, "모든 Severity");
const CATEGORY_OPTIONS = toOptions(ISSUE_CATEGORIES, "모든 Category");
const STATUS_OPTIONS = toOptions(ISSUE_STATUSES, "모든 Status");

/**
 * Issue 목록의 Search / Filter.
 *
 * Client Component 인 이유: 사용자 입력이 있는 Form 이다(CLAUDE.md 8).
 * 결과는 Client State 에 담지 않고 **URL Search Params 로만** 나간다 —
 * 서버가 그 값으로 다시 조회하고 다시 그린다. 목록을 브라우저에서 다시 불러오지 않는다.
 */
export function IssueFilterBar({
  basePath,
  filter,
}: {
  /** 이 목록이 사는 Workspace 경로(`/w/{slug}/issues`). Filter 는 주소만 바꾸고 Workspace 를 넘지 않는다. */
  basePath: Route;
  filter: IssueFilter;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<IssueFilterForm>({
    resolver: zodResolver(issueFilterFormSchema),
    values: {
      q: filter.q,
      severity: filter.severity,
      category: filter.category,
      status: filter.status,
    },
  });

  function navigate(next: IssueFilterForm) {
    // Filter 가 바뀌면 1페이지부터 본다 — 3페이지에서 조건을 바꾸면 빈 화면이 나온다.
    const queryString = issueFilterToQueryString({ ...next, page: 1 });
    startTransition(() => {
      router.replace(
        queryString === "" ? basePath : (`${basePath}?${queryString}` as Route),
        { scroll: false },
      );
    });
  }

  return (
    <form
      onSubmit={handleSubmit(navigate)}
      className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3"
    >
      <div className="flex flex-col">
        <SearchField
          label="검색"
          placeholder="제목 · 파일 · Pattern"
          className="w-64"
          aria-invalid={errors.q !== undefined}
          {...register("q")}
        />
        {errors.q !== undefined && (
          <span role="alert" className="mt-1 text-xs text-destructive">
            {errors.q.message}
          </span>
        )}
      </div>

      <Controller
        control={control}
        name="severity"
        render={({ field }) => (
          <FilterSelectField
            label="Severity"
            value={field.value}
            onValueChange={field.onChange}
            options={SEVERITY_OPTIONS}
            className="w-40"
          />
        )}
      />

      <Controller
        control={control}
        name="category"
        render={({ field }) => (
          <FilterSelectField
            label="Category"
            value={field.value}
            onValueChange={field.onChange}
            options={CATEGORY_OPTIONS}
            className="w-52"
          />
        )}
      />

      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <FilterSelectField
            label="Status"
            value={field.value}
            onValueChange={field.onChange}
            options={STATUS_OPTIONS}
            className="w-40"
          />
        )}
      />

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "조회 중" : "조회"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          reset({
            q: "",
            severity: FILTER_ALL,
            category: FILTER_ALL,
            status: FILTER_ALL,
          });
          startTransition(() => {
            router.replace(basePath, { scroll: false });
          });
        }}
      >
        초기화
      </Button>
    </form>
  );
}
