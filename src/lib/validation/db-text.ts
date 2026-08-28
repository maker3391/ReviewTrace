/**
 * PostgreSQL `text` 가 «담을 수 있는» 문자인가.
 *
 * ## 왜 이 검사가 따로 필요한가
 *
 * Zod 의 `z.string()` 은 **JavaScript 문자열이면 전부 통과시킨다.** 그런데 우리가 그것을
 * 저장하는 곳은 JavaScript 가 아니라 UTF-8 PostgreSQL 이고, 그쪽이 못 받는 문자가 둘 있다.
 *
 * | 문자 | PostgreSQL |
 * |---|---|
 * | `U+0000` (NUL) | `text` 에 저장할 수 없다 — `invalid Unicode escape value` |
 * | 짝 없는 Surrogate (`U+D800`~`U+DFFF`) | 유효한 UTF-8 로 인코딩되지 않는다 |
 *
 * 🔴 **검증이 통과시킨 값을 Driver 가 거절하면 그것은 `500` 이 된다.** 요청이 잘못됐는데도
 * 「서버가 실패했다」로 답하는 셈이라 Error Contract 가 깨지고(CLAUDE.md 13), 무엇보다
 * **5xx 를 재시도하도록 만들어진 Agent 가 영원히 같은 요청을 다시 보낸다** — 몇 번을 보내도
 * 성공할 수 없는 요청이다. 400 으로 답해야 Agent 가 「내가 보낸 것이 틀렸다」를 안다.
 *
 * ## 왜 이것이 현실적인 입력인가
 *
 * 지어낸 공격이 아니다. Agent 는 **코드에서 읽은 조각**을 `description` 에 담는다 —
 * 바이너리가 섞인 파일이나 깨진 인코딩을 인용하면 NUL 이 그대로 따라 들어온다.
 * ReviewTrace 의 주 입력 경로에서 평범하게 일어날 수 있는 일이다.
 *
 * ## 왜 「거르지」 않고 「거절」하는가
 *
 * 조용히 지우면 저장된 Knowledge 가 Agent 가 보낸 것과 달라진다. Review 기록은 나중에
 * 다시 읽어 근거로 쓰는 값이라(CLAUDE.md 1), 우리가 말없이 고친 본문을 사실로 남기지 않는다.
 */

/**
 * NUL, 또는 짝을 이루지 못한 Surrogate.
 *
 * 🔴 `u` flag 를 붙이지 않는다. 붙이면 엔진이 문자열을 Code Point 단위로 읽어
 * **짝 없는 Surrogate 를 하나의 문자로 취급**해 버려 정작 찾으려는 것이 걸리지 않는다.
 * 여기서는 Code Unit 단위로 보고 앞뒤 짝을 직접 확인해야 한다.
 */
const UNSTORABLE =
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** PostgreSQL `text` 에 그대로 저장할 수 있는 문자열인가. */
export function isStorableText(value: string): boolean {
  return !UNSTORABLE.test(value);
}

/**
 * 값 안 어디에든(중첩 Object·배열 포함) 저장 불가 문자가 있는가.
 *
 * 🔴 **Schema 마다 필드별로 붙이지 않고 «본문 하나»를 훑는 이유가 여기 있다.**
 * 필드에 붙이면 새 필드를 더할 때마다 잊을 수 있고, 잊은 자리는 조용히 500 으로 돌아온다.
 * 경계에서 한 번 훑으면 잊을 자리가 없다.
 *
 * Key 도 본다 — Key 가 그대로 저장되는 자리(`rawPayload` JSONB)가 있다.
 */
export function hasUnstorableText(value: unknown): boolean {
  if (typeof value === "string") {
    return !isStorableText(value);
  }

  if (Array.isArray(value)) {
    return value.some(hasUnstorableText);
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(
      ([key, child]) => !isStorableText(key) || hasUnstorableText(child),
    );
  }

  return false;
}
