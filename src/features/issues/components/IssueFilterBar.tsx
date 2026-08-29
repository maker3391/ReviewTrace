"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller } from "react-hook-form";

import { Spinner } from "@/components/atoms/Spinner";
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
  type IssueCategory,
  type IssueSeverity,
  type IssueStatus,
} from "@/types/review";
import { useLocalizedForm } from "@/lib/validation/use-localized-form";

/**
 * 🔴 **`value` 는 Domain 값 그대로다**(CLAUDE.md 2·13). `HIGH` · `TRANSACTION` ·
 * `OPEN` 이 그대로 URL Search Param 에 실려 서버 조회로 간다 — 바뀌는 것은 **보이는
 * 글자**(`label`)뿐이다. 여기서 값을 옮기면 고른 것과 주소가 갈린다.
 */
function toOptions<Value extends string>(
  values: readonly Value[],
  allLabel: string,
  labels: Record<Value, string>,
): FilterOption[] {
  return [
    { value: FILTER_ALL, label: allLabel },
    ...values.map((value) => ({ value, label: labels[value] })),
  ];
}

/** 이 화면이 그리는 낱말. 🔴 사전 전체를 넘기지 않는다(CLAUDE.md 11). */
export interface IssueFilterLabels {
  search: string;
  searchPlaceholder: string;
  severity: string;
  category: string;
  status: string;
  allSeverity: string;
  allCategory: string;
  allStatus: string;
  /** 🔴 값의 이름표. 값 자체는 `types/review.ts` 것을 그대로 쓴다. */
  severityOptions: Record<IssueSeverity, string>;
  categoryOptions: Record<IssueCategory, string>;
  statusOptions: Record<IssueStatus, string>;
  submit: string;
  submitting: string;
  reset: string;
}

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
  labels,
}: {
  /** 이 목록이 사는 Workspace 경로(`/w/{slug}/issues`). Filter 는 주소만 바꾸고 Workspace 를 넘지 않는다. */
  basePath: Route;
  filter: IssueFilter;
  labels: IssueFilterLabels;
}) {
  const severityOptions = toOptions(
    ISSUE_SEVERITIES,
    labels.allSeverity,
    labels.severityOptions,
  );
  const categoryOptions = toOptions(
    ISSUE_CATEGORIES,
    labels.allCategory,
    labels.categoryOptions,
  );
  const statusOptions = toOptions(
    ISSUE_STATUSES,
    labels.allStatus,
    labels.statusOptions,
  );

  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useLocalizedForm<IssueFilterForm>(issueFilterFormSchema, {
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
      className="flex flex-wrap items-end gap-3 border-b border-border px-1 py-3 sm:px-4"
    >
      <div className="flex min-w-0 flex-1 flex-col sm:flex-none">
        <SearchField
          label={labels.search}
          placeholder={labels.searchPlaceholder}
          className="w-full sm:w-64"
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
            label={labels.severity}
            value={field.value}
            onValueChange={field.onChange}
            options={severityOptions}
            className="w-[calc(50%-0.375rem)] sm:w-40"
          />
        )}
      />

      <Controller
        control={control}
        name="category"
        render={({ field }) => (
          <FilterSelectField
            label={labels.category}
            value={field.value}
            onValueChange={field.onChange}
            options={categoryOptions}
            className="w-[calc(50%-0.375rem)] sm:w-52"
          />
        )}
      />

      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <FilterSelectField
            label={labels.status}
            value={field.value}
            onValueChange={field.onChange}
            options={statusOptions}
            className="w-[calc(50%-0.375rem)] sm:w-40"
          />
        )}
      />

      <Button type="submit" size="sm" disabled={isPending}>
        {/* 🔴 label 을 갈아 끼우지 않는다 — 무엇을 실행 중인지가 계속 보여야 한다. */}
        {isPending && <Spinner />}
        {labels.submit}
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
        {labels.reset}
      </Button>
    </form>
  );
}
