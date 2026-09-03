"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useWatch } from "react-hook-form";

import { Spinner } from "@/components/atoms/Spinner";
import {
  FilterSelectField,
  type FilterOption,
} from "@/components/molecules/FilterSelectField";
import { SearchField } from "@/components/molecules/SearchField";
import { Button } from "@/components/ui/button";
import {
  FILTER_ALL,
  hasIssueFilterValue,
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
 * 🔴 **`value` 는 Domain 값 그대로다**. `HIGH` · `TRANSACTION` ·
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

/**
 * 고를 수 있는 저장소 하나.
 *
 * 🔴 **`repositories` Feature 의 타입을 가져오지 않는다.** 이 Component 가 아는 것은
 * 「id 와 보이는 이름」뿐이고, 그 이상을 알면 Issue 화면이 저장소 조회의 모양에 묶인다.
 * 목록을 «만드는» 것은 그 표의 주인이고(`listRepositoryOptions`), 조립은 `app/` 이 한다.
 */
export interface IssueRepositoryOption {
  id: string;
  /** 화면에 그대로 그린다 — 표기 규칙은 표·상세와 같은 `repositories.full_name` 이다. */
  fullName: string;
}

/** 이 화면이 그리는 낱말. 🔴 사전 전체를 넘기지 않는다. */
export interface IssueFilterLabels {
  search: string;
  searchPlaceholder: string;
  repository: string;
  allRepository: string;
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
 * Client Component 인 이유: 사용자 입력이 있는 Form 이다.
 * 결과는 Client State 에 담지 않고 **URL Search Params 로만** 나간다 —
 * 서버가 그 값으로 다시 조회하고 다시 그린다. 목록을 브라우저에서 다시 불러오지 않는다.
 */
export function IssueFilterBar({
  basePath,
  filter,
  repositories,
  labels,
}: {
  /** 이 목록이 사는 Workspace 경로(`/w/{slug}/issues`). Filter 는 주소만 바꾸고 Workspace 를 넘지 않는다. */
  basePath: Route;
  filter: IssueFilter;
  /** 🔴 **이 Project 에 연결된 저장소만** 들어온다. Workspace 전체도, GitHub 전체도 아니다. */
  repositories: readonly IssueRepositoryOption[];
  labels: IssueFilterLabels;
}) {
  const repositoryOptions: FilterOption[] = [
    { value: FILTER_ALL, label: labels.allRepository },
    ...repositories.map((repository) => ({
      value: repository.id,
      label: repository.fullName,
    })),
  ];

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
      repositoryId: filter.repositoryId,
      severity: filter.severity,
      category: filter.category,
      status: filter.status,
    },
  });

  /*
 🔴 **주소(`filter`)가 아니라 «지금 폼에 들어 있는 값»을 본다.** 검색어를 쳐 놓고 아직
 조회하지 않았어도 지울 것은 있다 — 주소만 보면 그 글자가 없는 것으로 읽힌다.
 */
  const current = useWatch({ control });
  const canReset = hasIssueFilterValue({
    q: current.q ?? "",
    repositoryId: current.repositoryId ?? FILTER_ALL,
    severity: current.severity ?? FILTER_ALL,
    category: current.category ?? FILTER_ALL,
    status: current.status ?? FILTER_ALL,
  });

  function navigate(next: IssueFilterForm) {
    /*
 Filter 가 바뀌면 1페이지부터 본다 — 3페이지에서 조건을 바꾸면 빈 화면이 나온다.

 🔴 **`pageSize` 는 함께 되돌리지 않는다.** 그것은 조회 조건이 아니라 「어떻게
 보는가」라, 검색어를 바꿀 때마다 25개로 되돌아가면 고른 것이 자꾸 풀린다.
 */
    const queryString = issueFilterToQueryString({
      ...next,
      page: 1,
      pageSize: filter.pageSize,
    });
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

      {/*
 🔴 **저장소가 몇 개든 «늘» 그린다.** 심각도·분류·상태가 그 Project 에 실제로 쓰인 값이
 몇 가지든 늘 서 있는 것과 같은 규칙이다 — Filter 줄의 모양이 데이터에 따라 달라지면
 같은 Workspace 의 Project 를 오갈 때마다 도구가 있었다 없었다 한다.

 🔴 **「선택지가 하나뿐이면 숨긴다」는 더 나쁘다.** 그 조건은 고른 값에 따라 참·거짓이
 뒤집혀, 저장소로 좁혔다가 초기화하는 순간 방금 쓰던 칸이 눈앞에서 사라진다. 주소로
 들어온 범위 밖의 값을 되돌릴 자리도 함께 없어진다.

 한 쪽뿐일 때 이동 도구를 접는 `organisms/TablePagination.tsx` 와는 다른 자리다 —
 그쪽은 «결과»를 넘기는 도구라 넘길 곳이 없으면 누를 것도 없지만, 이쪽은 조건을 «세우는»
 도구라 지금 무엇으로 좁혀져 있는지가 늘 보여야 한다.
 */}
      <Controller
        control={control}
        name="repositoryId"
        render={({ field }) => (
          <FilterSelectField
            label={labels.repository}
            value={field.value}
            onValueChange={field.onChange}
            options={repositoryOptions}
            /*
 `owner/repository` 는 심각도·상태보다 길다 — 좁은 화면에서는 한 줄을 통째로 쓰고
 넓은 화면에서만 옆에 선다. 🔴 다른 Filter 의 폭을 줄여 자리를 만들지 않는다.
 넘치는 이름은 Trigger 가 한 줄로 잘라 그린다(`ui/select.tsx`).
 */
            className="w-full sm:w-56"
          />
        )}
      />

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

      {/*
 🔴 **Spinner 가 뜬다고 버튼이 넓어지지 않는다.** 아이콘을 조건부로 «더하면» 그 폭만큼
 버튼이 자라고 옆의 「초기화」가 통째로 밀린다 — 누른 순간 손끝 아래에서 도구가 움직인다.
 그렇다고 쉴 때 빈 자리를 잡아 두면 이번엔 「조회」가 늘 오른쪽으로 치우친다.

 그래서 **이름표를 지우지 않고 «감춘다».** 글자가 자리를 그대로 차지하니 버튼은 자기
 폭을 유지하고, Spinner 는 `absolute` 로 흐름 밖에서 그 한가운데에 선다. 쉴 때 버튼에
 남는 여분은 없다 — 「조회」가 좌우 같은 여백 사이의 정중앙이다.

 🔴 **`invisible` 이 아니라 `opacity-0` 이다.** `visibility: hidden` 은 자리는 남기지만
 **접근성 트리에서 사라져** 읽는 도구에게 이름 없는 버튼이 된다 — 지금 누른 것이
 무엇이었는지가 그 순간 없어진다. 투명하게 두면 이름은 남는다.

 🔴 **label 을 갈아 끼우지도 않는다**(`atoms/Spinner.tsx`). 사전의 `submitting` 은 그래서
 화면에 쓰이지 않는다 — 짧은 조회에서 글자가 바뀌면 무엇을 눌렀는지가 흔들린다.

 🔴 **가운데를 `translate` 로 잡지 않는다.** `animate-spin` 의 keyframe 이 `transform` 을
 통째로 덮어써 아이콘이 제자리를 잃는다 — `inset-0 m-auto` 로 세운다.
 */}
      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        aria-busy={isPending}
        className="relative"
      >
        {isPending && <Spinner className="absolute inset-0 m-auto" />}
        <span className={isPending ? "opacity-0" : undefined}>
          {labels.submit}
        </span>
      </Button>
      {/*
 🔴 **「조회」와 같은 강도로 세우지 않는다.** 표면 없이 두면 배경에 묻혀 누를 것으로
 읽히지 않고, 채워 두면 어느 쪽이 주 동작인지 사라진다 — 테두리만 있는 `outline` 이
 그 사이다. 같은 화면 밖의 보조 동작(`error.tsx` 의 다시 시도 · Repository 연결 ·
 Project 설정)이 이미 쓰는 자리라 새 모양을 만들지 않았다.

 🔴 **되돌릴 것이 없으면 누를 수 없다.** 전부 기본값인데 눌러 봐야 같은 주소로 다시
 갈 뿐이다 — 첫 쪽에서 「이전」을 죽이는 `organisms/TablePagination.tsx`,
 고친 것이 없으면 저장을 죽이는 `IssueEditDialog` 와 같은 규칙이다.
 */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!canReset}
        onClick={() => {
          const cleared = {
            q: "",
            repositoryId: FILTER_ALL,
            severity: FILTER_ALL,
            category: FILTER_ALL,
            status: FILTER_ALL,
          } as const;
          reset(cleared);
          // 초기화도 같은 길로 간다 — 쪽 크기는 남고 쪽 번호만 처음으로 돌아간다.
          navigate(cleared);
        }}
      >
        {labels.reset}
      </Button>
    </form>
  );
}
