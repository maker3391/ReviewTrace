import { z } from "zod";

import { LOCALES, messages, type Locale } from "@/config/i18n";
import {
  VALIDATION_RULES,
  type ValidationRule,
} from "@/lib/validation/validation-rule";

/**
 * Zod 오류를 화면 언어로 옮기는 자리.
 *
 * ## 🔴 왜 «Schema» 가 아니라 여기인가
 *
 * ```text
 * Validation rule -> Zod issue(code · path · params) -> 이 경계 -> 사람이 읽는 문구
 * ```
 *
 * Schema 는 **무엇이 올바른가**만 안다. 「제목을 입력하세요」는 화면의 말이라 Schema 가
 * 그것을 직접 갖고 있으면 **한 언어에 묶인다** — 실제로 그랬고, 그래서 EN 화면에 한국어가
 * 그대로 떴다. Schema 가 아는 것은 `min(1)` 이라는 **규칙**과, 우리 고유 규칙이면
 * `params.rule` 이라는 **이름**뿐이다. 문구는 사전(`config/messages`)이 갖는다.
 *
 * 🔴 **의존 방향이 한쪽이다** — `schema -> messages/ko.ts` 도 `schema -> cookie` 도
 * `schema -> React` 도 없다. Schema 는 이 파일을 알지 못하고, 이 파일이 Schema 의
 * 결과(issue)를 읽는다.
 *
 * ## 🔴 `z.config()` 를 쓰지 않는 이유
 *
 * `z.config(z.locales.ko())` 는 **프로세스 전역**이다. 서버 하나가 KO 요청과 EN 요청을
 * 동시에 처리하므로, 요청마다 전역을 바꾸면 **한 요청의 언어가 다른 요청의 오류 문구를
 * 바꾼다.** 그래서 Zod 4 의 **per-parse** 경계만 쓴다 —
 * `schema.safeParse(value, { error: validationErrorMap(locale) })`.
 *
 * 아래 `ERROR_MAPS` 는 모듈이 올라올 때 한 번 만들어지고 **다시 쓰이지 않는다.**
 * 값이 `locale` 인자에만 달려 있어 요청끼리 섞일 수 있는 상태가 없다.
 *
 * ## 🔴 Zod 가 이미 아는 것을 베끼지 않는다
 *
 * `invalid_type` · `unrecognized_keys` · 숫자·배열의 크기 같은 일반 검증은
 * **Zod 공식 로케일**(`z.locales.ko()` · `z.locales.en()`)이 이미 갖고 있다. 여기서
 * 다시 적는 것은 **화면 폼에 실제로 뜨는 몇 가지**와 ReviewTrace 고유 규칙뿐이고,
 * 나머지는 공식 로케일로 떨어진다 — 어느 쪽이든 **영어 기본값으로 새지 않는다.**
 */

type ErrorMap = z.core.$ZodErrorMap;
type RawIssue = z.core.$ZodRawIssue;

function ruleOf(issue: RawIssue): ValidationRule | null {
  const rule = (issue.params as { rule?: unknown } | undefined)?.rule;
  return typeof rule === "string" &&
    (VALIDATION_RULES as readonly string[]).includes(rule)
    ? (rule as ValidationRule)
    : null;
}

/** `minimum`·`maximum` 은 `number | bigint` 다. 문구에 넣기 전에 좁힌다. */
function size(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function buildErrorMap(locale: Locale): ErrorMap {
  const t = messages(locale).validation;
  /** Zod 공식 로케일. 우리가 손대지 않은 모든 code 가 여기로 떨어진다. */
  const generic = (locale === "en" ? z.locales.en() : z.locales.ko())
    .localeError;

  return (issue) => {
    const rule = ruleOf(issue);
    if (rule !== null) {
      return t.rules[rule];
    }

    switch (issue.code) {
      case "too_small":
        // 🔴 규칙을 바꾸지 않는다 — `min(1)` 은 그대로 `min(1)` 이고, 말만 「필수」다.
        if (issue.origin === "string") {
          const minimum = size(issue.minimum);
          return minimum <= 1 ? t.required : t.tooShort(minimum);
        }
        break;
      case "too_big":
        // 🔴 길이를 문구에서 지우지 않는다. 「너무 깁니다」가 아니라 「200자」다.
        if (issue.origin === "string") {
          return t.tooLong(size(issue.maximum));
        }
        break;
      case "invalid_format":
        if (issue.format === "email") {
          return t.email;
        }
        break;
      default:
        break;
    }

    return generic?.(issue);
  };
}

/**
 * 언어마다 하나씩, **모듈이 올라올 때** 만들어 둔다.
 *
 * 🔴 요청마다 다시 만들지도, 어딘가를 고쳐 쓰지도 않는다. 「지금 무슨 언어인가」라는
 * 상태가 없으므로 동시 요청이 서로의 언어를 바꿀 방법이 없다.
 */
const ERROR_MAPS: Readonly<Record<Locale, ErrorMap>> = Object.freeze(
  Object.fromEntries(
    LOCALES.map((locale) => [locale, buildErrorMap(locale)]),
  ) as Record<Locale, ErrorMap>,
);

/** 이 언어로 Zod 오류를 적는 error map. `safeParse(value, { error: … })` 에 넣는다. */
export function validationErrorMap(locale: Locale): ErrorMap {
  return ERROR_MAPS[locale];
}

/** Zod 의 per-parse 경계에 그대로 넘길 수 있는 모양. */
export function parseOptions(locale: Locale): { error: ErrorMap } {
  return { error: validationErrorMap(locale) };
}
