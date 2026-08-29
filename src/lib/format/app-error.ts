import {
  isAppError,
  type AppErrorMessages,
  type AppErrorMeta,
  type AppErrorReason,
  type PublicError,
} from "@/lib/errors";

/**
 * 오류를 **사람이 읽는 문구**로 옮기는 자리.
 *
 * ```text
 * Application  ──AppError(reason · meta)──▶  여기  ──▶  { code, message }  ──▶  화면
 * ```
 *
 * ## 🔴 왜 Application 이 아니라 여기인가
 *
 * Application 은 「무엇이 잘못됐는가」만 안다. 「같은 slug 의 Project 가 이미 있습니다」는
 * **화면의 말**이라, Service 가 그것을 직접 갖고 있으면 한 언어에 묶인다 — 실제로 그랬고
 * EN 화면에 한국어가 그대로 떴다. Zod 오류를 `lib/validation/zod-error-map.ts` 로 옮긴
 * 것과 같은 이유·같은 모양이다.
 *
 * 🔴 **의존 방향이 한쪽이다.** 이 파일이 `lib/errors` 를 보고, `lib/errors` 는 여기를
 * 알지 못한다. Presentation -> Application 뿐이고 반대는 없다.
 *
 * 🔴 **여기서 쿠키를 읽지 않는다.** 사전을 «받는다» — 순수 함수라 시험이 두 언어를
 * 나란히 세워 볼 수 있고, Client Bundle 로 넘어가도 `next/headers` 를 끌고 가지 않는다.
 * 쿠키를 읽는 자리는 `lib/action/action-error.ts`(서버 전용) 한 곳이다.
 *
 * 🔴 **Agent API 는 여기를 부르지 않는다.** 그쪽은 언어와 무관해야 하므로
 * `lib/errors.ts` 의 `toPublicError` 를 쓴다 — 문구의 출처가 아예 다르다.
 */

/**
 * 사전에 문구가 없을 때.
 *
 * 타입이 이미 막고 있어(`AppErrorMessages`) 여기에 닿으려면 캐스팅으로 우회해야 한다.
 * 그래도 조용히 「오류가 발생했습니다」로 떨어지면 **번역 누락을 영영 못 찾는다**(스펙 11)
 * — 개발·시험에서는 던져서 즉시 드러내고, 운영에서는 화면을 깨뜨리는 대신 서버 Log 에
 * 남기고 일반 문구로 내려간다.
 */
function missing(reason: string, fallback: string): string {
  if (process.env.NODE_ENV !== "production") {
    throw new Error(`오류 문구가 사전에 없다: ${reason}`);
  }
  console.error("[app-error] 오류 문구가 사전에 없다", reason);
  return fallback;
}

function messageFor(
  reason: AppErrorReason,
  meta: AppErrorMeta | undefined,
  errors: AppErrorMessages,
): string {
  const entry: unknown = errors[reason];

  if (typeof entry === "string") {
    return entry;
  }
  if (typeof entry === "function") {
    /*
      값이 필요한 오류는 생성자가 이미 값을 요구했다(`AppErrorArgs`). 사전 쪽 타입은
      reason 마다 다른 인자를 갖는데 여기 오는 reason 은 union 이라, 짝을 다시 세우는
      대신 **이 한 자리에서만** 좁힌다.
    */
    return (entry as (value: AppErrorMeta | undefined) => string)(meta);
  }

  return missing(reason, errors.UNEXPECTED);
}

/**
 * 무엇이 던져졌든 화면에 그릴 수 있는 형태로 좁힌다.
 *
 * 🔴 알 수 없는 오류는 `INTERNAL_ERROR` 로 뭉갠다 — 원본 `message` 에는 접속 문자열·쿼리가
 * 실려 오므로 화면에 흘리지 않는다(CLAUDE.md 19). 원인은 부르는 쪽이 서버 Log 에 남긴다.
 */
export function localizedPublicError(
  error: unknown,
  errors: AppErrorMessages,
): PublicError {
  if (!isAppError(error)) {
    return { code: "INTERNAL_ERROR", message: errors.UNEXPECTED };
  }

  return {
    code: error.code,
    message: messageFor(error.reason, error.meta, errors),
  };
}
