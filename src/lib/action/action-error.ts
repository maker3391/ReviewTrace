import "server-only";

import { unstable_rethrow } from "next/navigation";

import { DEFAULT_LOCALE, messages } from "@/config/i18n";
import type { ActionResult } from "@/lib/action/action-result";
import { localizedPublicError } from "@/lib/format/app-error";
import {
  AppError,
  type AppErrorArgs,
  type AppErrorMessages,
  type AppErrorReason,
} from "@/lib/errors";
import { readLocale } from "@/lib/ui/appearance";

/**
 * Server Action 이 실패를 화면 말로 옮기는 **한 자리**.
 *
 * ```text
 * Application Service ──throw AppError(reason)──▶ Server Action(catch) ──▶ 여기
 * |
 * 쿠키에서 언어 ──▶ 사전 ──▶ { code, message }
 * ```
 *
 * 🔴 **화면마다 `if (code === …)` 를 적지 않는다.** Server Action 은 이미 모든 실패가
 * 지나가는 목이고 서버에서 돌아 쿠키를 볼 수 있다 — 여기서 문구를 만들면 열두 개의
 * Client Component 는 `result.error.message` 를 그리기만 하면 된다.
 *
 * 🔴 **`server-only` 다.** 이 모듈이 Client Bundle 로 넘어가면 `next/headers` 가 빌드를
 * 깨뜨린다 — 경계를 주석이 아니라 빌드가 지키게 한다. 문구를 «고르는»
 * 순수 부분은 `lib/format/app-error.ts` 에 있어 시험이 서버 없이 부를 수 있다.
 */

/**
 * 🔴 **언어를 못 읽는 것이 실패 처리를 다시 실패시킬 이유는 아니다.**
 *
 * `cookies()` 는 요청 밖에서 부르면 던진다(단위 시험에서 Server Action 을 곧바로 부르는
 * 경우가 그렇다). 오류를 옮기는 자리에서 또 던지면 원래 오류가 통째로 사라진다 —
 * 그때는 기본 언어로 적는다(`lib/action/parse-action-input.ts` 와 같은 정책이다).
 */
async function currentErrorMessages(): Promise<AppErrorMessages> {
  try {
    return messages(await readLocale()).errors;
  } catch {
    return messages(DEFAULT_LOCALE).errors;
  }
}

/**
 * 던져진 오류를 `ActionResult` 로 옮긴다.
 *
 * 알 수 없는 오류는 `INTERNAL_ERROR` 로 뭉개진다 — 원본 message 를 화면에 흘리지 않는다.
 *
 * 🔴 **Next.js 의 흐름 제어는 예외로 온다. 그것까지 뭉개면 안 된다.**
 * `redirect()`·`notFound()` 는 값을 돌려주지 않고 특수 예외를 던져 라우터에게 다음 일을
 * 시킨다. Server Action 이 `try { requireProject() } catch (e) { return actionFromError(e) }`
 * 로 감싸면 그 예외가 여기까지 와서 **`INTERNAL_ERROR` 한 줄로 바뀐다** — 화면은 이동하지도
 * 404 를 그리지도 못하고 「요청을 처리하지 못했습니다」만 띄운다. 로그인하지 않은 사람이
 * 초대를 수락할 때, 그리고 남의 Project 의 Issue 상태를 바꾸려 할 때 실제로 그랬다.
 *
 * `unstable_rethrow` 는 그 내부 예외만 골라 다시 던진다(Next.js 16 `next/navigation`).
 * **부르는 자리마다 기억하게 두지 않고 여기 한 곳에 둔다** — Server Action 의 catch 는
 * 전부 이 함수를 지나므로, 새 Action 을 만드는 사람이 잊어도 같은 보증을 받는다.
 */
export async function actionFromError<T = never>(
  error: unknown,
): Promise<ActionResult<T>> {
  unstable_rethrow(error);
  return {
    ok: false,
    error: localizedPublicError(error, await currentErrorMessages()),
  };
}

/**
 * Server Action 이 Application Service 를 부르기 «전에» 스스로 거절할 때.
 *
 * 🔴 **문구를 인자로 받지 않는다.** 받으면 그 자리에 한국어 한 줄이 박힌다 —
 * 넘기는 것은 오류의 «의미»뿐이고, 값이 필요한 오류는 타입이 값을 요구한다.
 */
export async function actionFail<R extends AppErrorReason>(
  ...args: AppErrorArgs<R>
): Promise<ActionResult<never>> {
  return actionFromError(
    new AppError(...(args as AppErrorArgs<AppErrorReason>)),
  );
}
