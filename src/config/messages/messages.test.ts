import { describe, expect, it } from "vitest";

import { en } from "@/config/messages/en";
import { ko } from "@/config/messages/ko";
import {
  ISSUE_ACTIVITY_TYPES,
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  REVIEW_TARGET_TYPES,
  REVIEWER_TYPES,
  SCM_PROVIDERS,
  WORKSPACE_ROLES,
} from "@/types/review";

/**
 * 사전의 회귀 시험.
 *
 * 🔴 **문구를 한 줄씩 굳히지 않는다.** 낱말은 계속 다듬는 것이라 snapshot 을 뜨면
 * 고칠 때마다 시험이 깨지고, 깨진 시험은 곧 아무도 읽지 않는다. 여기서 잡는 것은
 * **두 언어가 갈라지는 방식** 셋뿐이다:
 *
 * 1. 한국어 화면의 주요 이름표가 영어로 되돌아가는 것
 * 2. 영어 화면에 한국어가 새어 나가는 것
 * 3. Domain 에 값이 늘었는데 이름표가 빠져 화면에 `undefined` 가 찍히는 것
 */

/** 한글 음절. 자모만 있는 값은 문구가 아니므로 굳이 보지 않는다. */
const HANGUL = /[가-힣]/;

/** 사전을 훑어 «문자열 값»만 경로와 함께 뽑는다. 함수는 인자를 지어내지 않고 건너뛴다. */
function collectStrings(
  value: unknown,
  path = "",
  out: { path: string; text: string }[] = [],
): { path: string; text: string }[] {
  if (typeof value === "string") {
    out.push({ path, text: value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStrings(item, `${path}[${index}]`, out),
    );
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      collectStrings(item, path === "" ? key : `${path}.${key}`, out);
    }
  }
  return out;
}

describe("messages", () => {
  /**
   * 🔴 영어 사전에 한국어가 남아 있으면 EN 화면 한가운데에 한국어가 뜬다.
   * 예외는 언어 고르기의 「한국어」 하나뿐이다 — 그것은 번역 대상이 아니라 언어 «이름»이다.
   */
  it("영어 사전에는 한국어가 없다", () => {
    const leaked = collectStrings(en)
      .filter(({ text }) => HANGUL.test(text))
      .filter(
        ({ path }) =>
          path !== "appearance.localeKo" &&
          path !== "agentCredentials.korean",
      );

    expect(leaked).toEqual([]);
  });

  /**
   * 🔴 한국어 화면의 뼈대가 영어로 되돌아가는 것을 막는다.
   * 사이드바·KPI·표 머리글은 한 번 영어로 되돌아가면 화면 전체가 다시 섞여 보인다.
   */
  it("한국어 사전의 주요 이름표가 한국어다", () => {
    const labels = [
      ko.nav.workspace.DASHBOARD,
      ko.nav.workspace.PROJECTS,
      ko.nav.project.REVIEWS,
      ko.nav.project.ISSUES,
      ko.nav.project.REPOSITORIES,
      ko.workspaceDashboard.kpiIssuesFound,
      ko.workspaceDashboard.kpiOpen,
      ko.workspaceDashboard.needsAttention.title,
      ko.workspaceDashboard.patterns.title,
      ko.workspaceDashboard.activity.title,
      ko.issues.colSeverity,
      ko.issues.colStatus,
      ko.reviews.colReviewer,
      ko.repositories.colRepository,
      ko.common.viewAll,
      ko.projectDialog.trigger,
    ];

    expect(labels.every((label) => HANGUL.test(label))).toBe(true);
  });

  /**
   * 🔴 **값과 이름표를 가른다.** Domain 에 값이 하나 늘면 두 사전 모두 이름표를 가져야 한다 —
   * 빠지면 Badge 자리에 `undefined` 가 그려진다. 타입도 같은 것을 잡지만, 이 시험은
   * `Record` 를 손으로 풀어 쓴 자리까지 실제 값 목록으로 다시 확인한다.
   */
  it.each([
    ["severity", ISSUE_SEVERITIES],
    ["status", ISSUE_STATUSES],
    ["category", ISSUE_CATEGORIES],
    ["activityType", ISSUE_ACTIVITY_TYPES],
    ["targetType", REVIEW_TARGET_TYPES],
    ["reviewerType", REVIEWER_TYPES],
    ["provider", SCM_PROVIDERS],
    ["role", WORKSPACE_ROLES],
  ] as const)(
    "%s 의 모든 Domain 값에 두 언어의 이름표가 있다",
    (group, values) => {
      for (const value of values) {
        const koLabel = (ko.enums[group] as Record<string, string>)[value];
        const enLabel = (en.enums[group] as Record<string, string>)[value];

        expect(koLabel, `ko.enums.${group}.${value}`).toBeTruthy();
        expect(enLabel, `en.enums.${group}.${value}`).toBeTruthy();
      }
    },
  );

  /**
   * 🔴 **이름표가 값을 흉내내지 못하게 한다.**
   *
   * Filter 는 고른 «값»을 URL Search Param 으로 내보낸다. 이름표를 값 자리에
   * 잘못 넣는 실수가 나면 `?status=미해결` 같은 주소가 되어 서버 조회가 통째로 빈다 —
   * 이름표가 값과 절대 같지 않으면 그런 실수가 시험에서 먼저 드러난다.
   */
  it("한국어 이름표는 Domain 값과 같지 않다", () => {
    const sameAsValue = ISSUE_STATUSES.filter(
      (value) => ko.enums.status[value] === value,
    );

    expect(sameAsValue).toEqual([]);
  });

  /**
   * 🔴 **오류 화면의 낱말이 빠지면 그 자리에 `undefined` 가 그려진다.**
   *
   * `error.tsx`·`global-error.tsx` 는 무언가 이미 잘못된 자리에서 도는 화면이라
   * 사람 눈으로 마주칠 일이 드물다 — 빠져도 오래 안 들킨다. 그래서 여기서 잡는다.
   */
  it("⑨ 오류 화면의 낱말이 두 언어 모두 있다", () => {
    for (const key of Object.keys(
      ko.errorPage,
    ) as (keyof typeof ko.errorPage)[]) {
      expect(ko.errorPage[key], `ko.errorPage.${key}`).toMatch(HANGUL);
      expect(en.errorPage[key], `en.errorPage.${key}`).toBeTruthy();
      expect(en.errorPage[key], `en.errorPage.${key}`).not.toMatch(HANGUL);
    }
  });

  /**
   * 🔴 **검증 문구도 마찬가지다.** Schema 는 규칙만 갖고 말은 사전이 갖는다
   * (`lib/validation/zod-error-map.ts`) — 한쪽 언어에만 있는 규칙이 생기면
   * 그 언어의 화면에서 문구가 사라진다.
   */
  it("⑦⑧ 검증 문구가 두 언어 모두 제 언어로 있다", () => {
    expect(ko.validation.invalidInput).toMatch(HANGUL);
    expect(ko.validation.required).toMatch(HANGUL);
    expect(ko.validation.tooLong(200)).toContain("200");
    expect(en.validation.tooLong(200)).toContain("200");
    expect(en.validation.invalidInput).not.toMatch(HANGUL);

    for (const key of Object.keys(ko.validation.rules)) {
      const koRule = (ko.validation.rules as Record<string, string>)[key];
      const enRule = (en.validation.rules as Record<string, string>)[key];

      expect(koRule, `ko.validation.rules.${key}`).toMatch(HANGUL);
      expect(enRule, `en.validation.rules.${key}`).toBeTruthy();
      expect(enRule, `en.validation.rules.${key}`).not.toMatch(HANGUL);
    }
  });
});
