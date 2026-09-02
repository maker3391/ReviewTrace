import { describe, expect, it } from "vitest";

import {
  formatCompactDateTime,
  formatDate,
  formatExactDateTime,
  formatRelativeTime,
} from "@/lib/format/date";

const VALUE = new Date("2026-09-01T10:23:41.987Z");

describe("timestamp presentation policy", () => {
  /**
   * 🔴 **시간대를 주지 않으면 UTC 다 — 그리고 «언제나» 같은 값이다.**
   *
   * 서버는 보는 사람이 어디 있는지 모른다. 그래서 첫 렌더는 UTC 로 그리고, 브라우저가
   * 자기 시간대를 알려 준 뒤에만 바뀐다. 이 함수가 실행 환경의 시간대를 조금이라도
   * 타면 SSR HTML 과 첫 client 렌더가 갈려 hydration 이 어긋난다.
   */
  it("시간대를 주지 않으면 UTC 로 그리고, 실행 환경의 시간대를 타지 않는다", () => {
    expect(formatDate(VALUE)).toBe("2026-09-01");
    expect(formatExactDateTime(VALUE)).toBe("2026-09-01 10:23:41");
    expect(formatCompactDateTime(VALUE)).toBe("09-01 10:23");
  });

  // 🔴 화면에 `UTC`·`KST` 같은 시간대 이름을 붙이지 않는다 — 사람은 자기 시계를 본다.
  it("시간대 이름을 화면 문자열에 붙이지 않는다", () => {
    for (const zone of [undefined, "Asia/Seoul", "America/New_York"]) {
      expect(formatExactDateTime(VALUE, zone)).not.toMatch(/UTC|KST|GMT|[+-]\d\d:\d\d/u);
    }
  });

  it("보는 사람의 시간대로 옮겨 그린다", () => {
    // 10:23:41Z -> 서울은 +09:00
    expect(formatExactDateTime(VALUE, "Asia/Seoul")).toBe("2026-09-01 19:23:41");
    // 같은 instant 를 뉴욕에서 보면 -04:00(DST)
    expect(formatExactDateTime(VALUE, "America/New_York")).toBe(
      "2026-09-01 06:23:41",
    );
    // 30분 단위 offset 도 있다.
    expect(formatExactDateTime(VALUE, "Asia/Kolkata")).toBe(
      "2026-09-01 15:53:41",
    );
  });

  /** 🔴 시간대가 바뀌면 «날짜»가 바뀐다. 시각만 옮기고 날짜를 UTC 로 두면 하루가 틀린다. */
  it("날짜 경계를 넘어가면 날짜도 함께 옮긴다", () => {
    const lateUtc = new Date("2026-09-01T16:00:00.000Z");
    expect(formatDate(lateUtc)).toBe("2026-09-01");
    // 서울은 이미 다음 날 새벽 1시다.
    expect(formatDate(lateUtc, "Asia/Seoul")).toBe("2026-09-02");
    expect(formatCompactDateTime(lateUtc, "Asia/Seoul")).toBe("09-02 01:00");

    const earlyUtc = new Date("2026-09-01T02:00:00.000Z");
    // 뉴욕은 아직 전날 밤 10시다.
    expect(formatDate(earlyUtc, "America/New_York")).toBe("2026-08-31");
  });

  it("연말·연초에도 해가 함께 넘어간다", () => {
    const newYearEveUtc = new Date("2026-12-31T15:30:00.000Z");
    expect(formatDate(newYearEveUtc)).toBe("2026-12-31");
    // 서울은 이미 새해다.
    expect(formatExactDateTime(newYearEveUtc, "Asia/Seoul")).toBe(
      "2027-01-01 00:30:00",
    );
    const newYearUtc = new Date("2027-01-01T03:00:00.000Z");
    // 뉴욕은 아직 작년이다.
    expect(formatDate(newYearUtc, "America/New_York")).toBe("2026-12-31");
  });

  it("formats dashboard relative time in both locales", () => {
    const now = new Date("2026-09-01T12:23:41.987Z");
    expect(formatRelativeTime(VALUE, now, "ko")).toBe("2시간 전");
    expect(formatRelativeTime(VALUE, now, "en")).toBe("2h ago");
  });

  it("uses yesterday with the UTC clock time", () => {
    const now = new Date("2026-09-02T08:00:00.000Z");
    expect(formatRelativeTime(VALUE, now, "ko")).toBe("어제 10:23");
  });

  /**
   * 🔴 **「어제」는 보는 사람의 달력에서 어제여야 한다.**
   *
   * 경과 시간이 아니라 **날짜가 몇 번 넘어갔는가**로 세므로 기준 시간대가 답을 바꾼다.
   * 아래 두 instant 는 UTC 로는 같은 날이지만 서울에서는 하루가 갈린다.
   */
  it("어제 판정과 그 시각을 보는 사람의 달력으로 센다", () => {
    const value = new Date("2026-09-01T16:30:00.000Z"); // 서울 09-02 01:30
    const now = new Date("2026-09-02T16:00:00.000Z"); // 서울 09-03 01:00

    // UTC 달력으로는 09-01 과 09-02 라 하루 차이 — 「어제 16:30」
    expect(formatRelativeTime(value, now, "ko")).toBe("어제 16:30");
    // 서울 달력으로도 09-02 와 09-03 이라 하루 차이지만, 시각은 지역 시각이다.
    expect(formatRelativeTime(value, now, "ko", "Asia/Seoul")).toBe(
      "어제 01:30",
    );
  });

  it("시간대 때문에 「어제」가 「2일」이 되기도 한다", () => {
    const value = new Date("2026-09-01T16:30:00.000Z"); // 서울 09-02 01:30
    const now = new Date("2026-09-03T15:00:00.000Z"); // UTC 09-03 / 서울 09-04

    expect(formatRelativeTime(value, now, "ko")).toBe("2일");
    expect(formatRelativeTime(value, now, "ko", "Asia/Seoul")).toBe("2일");
  });

  it("handles null at the component boundary and invalid values in formatters", () => {
    const invalid = new Date(Number.NaN);
    expect(formatDate(invalid)).toBe("—");
    expect(formatExactDateTime(invalid)).toBe("—");
    expect(formatCompactDateTime(invalid)).toBe("—");
    expect(formatRelativeTime(invalid, VALUE, "ko")).toBe("—");
  });

  // 🔴 시간대를 줘도 잘못된 값은 여전히 `—` 다 — Intl 이 던져 화면을 깨뜨리지 않는다.
  it("잘못된 값은 시간대를 줘도 안전하게 —", () => {
    const invalid = new Date(Number.NaN);
    expect(formatDate(invalid, "Asia/Seoul")).toBe("—");
    expect(formatExactDateTime(invalid, "Asia/Seoul")).toBe("—");
    expect(formatCompactDateTime(invalid, "Asia/Seoul")).toBe("—");
    expect(formatRelativeTime(invalid, VALUE, "ko", "Asia/Seoul")).toBe("—");
  });

  /**
   * 🔴 **자정을 `24:00` 으로 내는 구현이 있다.** `hourCycle: "h23"` 을 줘도 일부 런타임이
   * 자정에 `24` 를 돌려줘 `2026-09-02 24:00:00` 같은 값이 나온다 — 사람이 읽을 수 없는
   * 시각이다. formatter 가 한 번 더 접는지 확인한다.
   */
  it("자정을 24시로 그리지 않는다", () => {
    const seoulMidnight = new Date("2026-09-01T15:00:00.000Z");
    const shown = formatExactDateTime(seoulMidnight, "Asia/Seoul");
    expect(shown).toBe("2026-09-02 00:00:00");
    expect(shown).not.toContain("24:00:00");
  });
});
