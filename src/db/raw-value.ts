import "server-only";

/**
 * 원시 SQL 조각(`sql<T>`)이 돌려준 값을 실제 타입으로 좁힌다.
 *
 * ## 왜 필요한가
 *
 * 🔴 **`sql<Date>` 는 «검사되지 않는 타입 단언»이다.** Drizzle 은 Column 을 통해 조회할 때만
 * Driver 값을 변환해 준다 — `max(...)` · `greatest(...)` · `coalesce(...)` 처럼 우리가 직접 쓴
 * 식은 그 경로 밖이라, TypeScript 가 `Date` 라고 믿는 값이 실행 시점에는 문자열일 수 있다.
 *
 * 그것이 실제로 터졌다:
 *
 * ```
 * TypeError: value.getUTCFullYear is not a function
 *   at formatDate (src/lib/format/date.ts)
 * ```
 *
 * 🔴 **화면에서 방어하지 않는다.** `formatDate` 가 문자열도 받아 주게 만들면 거짓말이 화면까지
 * 흘러온 뒤에 덮이고, 다음 사람은 어디서 타입이 갈렸는지 알 수 없다. **단언을 한 자리에서**
 * 실제 값으로 맞춘다 — 조회 함수가 화면에 넘기기 전에.
 *
 * `pnpm build` 도 `typecheck` 도 이것을 잡지 못한다. 잡은 것은 데이터를 넣고 화면을 연 것이다.
 */

/** `sql<Date>` 결과를 Date 로 좁힌다. 값이 없으면 `null`. */
export function asNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  // Driver 가 문자열·epoch 로 준 경우. 해석할 수 없으면 「없음」으로 떨어뜨린다 —
  // 화면이 `Invalid Date` 를 그리게 두지 않는다.
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 반드시 값이 있어야 하는 자리.
 *
 * 부르는 쪽이 `IS NOT NULL` 로 걸러 온 열에만 쓴다 — 그럼에도 값이 없으면 그것은 질의가
 * 우리 생각과 다르다는 뜻이므로 조용히 넘기지 않는다.
 */
export function asDate(value: unknown): Date {
  const parsed = asNullableDate(value);
  if (parsed === null) {
    throw new Error("시각이 있어야 하는 자리에 값이 없다");
  }
  return parsed;
}

/**
 * `count(*)::int` 같은 셈값을 숫자로 좁힌다.
 *
 * `bigint` 는 Driver 가 문자열로 준다. `::int` 를 붙여 두었더라도 식이 바뀌면 다시 문자열이
 * 되므로, 세는 값도 같은 자리에서 맞춘다.
 */
export function asCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
