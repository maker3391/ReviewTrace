import "server-only";

import type { z } from "zod";

import { DEFAULT_LOCALE, messages, type Locale } from "@/config/i18n";
import type { Messages } from "@/config/messages/ko";
import {
  actionValidationFailed,
  type ActionResult,
} from "@/lib/action/action-result";
import { readLocale } from "@/lib/ui/appearance";
import { parseOptions } from "@/lib/validation/zod-error-map";

/**
 * Server Action 의 입력 검증 한 자리.
 *
 * ```text
 * 화면 -> Server Action -> parseActionInput -> Application Service
 * |
 * +-> 실패는 예외가 아니라 ActionResult 로 돌아간다
 * ```
 *
 * 🔴 **브라우저 검증을 믿지 않는다.** Server Action 은 주소만 알면 누구나 부를 수 있어
 * 화면을 거치지 않은 값이 그대로 들어온다 — 같은 Schema 로 서버가 한 번 더 본다.
 *
 * 🔴 **오류 문구는 이 사람의 언어로 적는다.** Zod 기본값은 영어이고, Schema 는 언어를
 * 알지 못한다(`lib/validation/zod-error-map.ts`). 언어는 **이 parse 하나에만** 실려 가므로
 * (`safeParse(value, { error })`) 같은 순간 다른 언어로 도는 요청과 섞이지 않는다 —
 * 🔴 `z.config` 같은 전역을 요청마다 바꾸는 구조를 만들지 않는다.
 *
 * @param pickMessage 실패했을 때 화면 맨 아래에 뜨는 한 줄을 사전에서 고른다. 기본은
 * 「입력값이 올바르지 않습니다」이고, 그 자리에서 더 정확히 말할 수 있으면 넘긴다.
 * 🔴 **문자열이 아니라 «고르는 함수»를 받는다** — 부르는 쪽이 사전을 따로 읽으면
 * 같은 요청에서 쿠키를 두 번 보게 되고, 무엇보다 한국어를 손으로 적을 자리가 생긴다.
 */
export async function parseActionInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  pickMessage?: (validation: Messages["validation"]) => string,
): Promise<
  { ok: true; data: z.output<S> } | { ok: false; failure: ActionResult<never> }
> {
  const locale = await currentLocale();
  const validation = messages(locale).validation;
  const parsed = schema.safeParse(input, parseOptions(locale));

  if (parsed.success) {
    return { ok: true, data: parsed.data as z.output<S> };
  }

  return {
    ok: false,
    failure: actionValidationFailed(
      parsed.error,
      pickMessage === undefined
        ? validation.invalidInput
        : pickMessage(validation),
    ),
  };
}

/**
 * 🔴 **언어를 못 읽는 것이 검증을 실패시킬 이유는 아니다.**
 *
 * `cookies()` 는 요청 밖에서 부르면 던진다(단위 시험에서 Server Action 을 곧바로 부르는
 * 경우가 그렇다). 그때 요청 전체를 실패시키는 대신 기본 언어로 적는다 — 쿠키가 없거나
 * 이상한 값일 때 `parseLocale` 이 하는 일과 같은 정책이다(`config/i18n.ts`).
 */
async function currentLocale(): Promise<Locale> {
  try {
    return await readLocale();
  } catch {
    return DEFAULT_LOCALE;
  }
}
