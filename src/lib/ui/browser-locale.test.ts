import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_LOCALE } from "@/config/i18n";
import { readBrowserLocale } from "@/lib/ui/browser-locale";

/**
 * `global-error.tsx` 가 언어를 알아내는 마지막 수단의 회귀 시험.
 *
 * 🔴 **이 자리가 실패하면 사용자에게 남는 것은 빈 화면뿐이다.** Root Layout 이 이미
 * 깨진 상태에서 도는 코드라, 여기서 오류를 던지면 오류 화면이 오류를 낸다.
 * 그래서 「무슨 값이 들어와도 언어 하나를 돌려준다」를 값의 모양별로 확인한다.
 */

const originalDocument = globalThis.document;

function setCookie(value: string | undefined): void {
  if (value === undefined) {
    // 서버(그리고 prerender)에는 `document` 가 없다.
    Reflect.deleteProperty(globalThis, "document");
    return;
  }
  Object.defineProperty(globalThis, "document", {
    value: { cookie: value },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalDocument === undefined) {
    Reflect.deleteProperty(globalThis, "document");
  } else {
    Object.defineProperty(globalThis, "document", {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  }
});

describe("readBrowserLocale", () => {
  it("고른 언어를 읽는다", () => {
    setCookie("theme=dark; locale=en; sidebar=open");

    expect(readBrowserLocale()).toBe("en");
  });

  it("이름이 겹치는 쿠키에 속지 않는다", () => {
    // `xlocale=en` 은 다른 쿠키다.
    setCookie("xlocale=en; locale=ko");

    expect(readBrowserLocale()).toBe("ko");
  });

  /** 🔴 ⑪ 무엇이 들어와도 다시 죽지 않는다. */
  it.each([
    ["쿠키가 없다", ""],
    ["언어 쿠키만 없다", "theme=dark"],
    ["값이 비었다", "locale="],
    ["아는 언어가 아니다", "locale=fr"],
    ["값이 아니라 문장이다", "locale=<script>alert(1)</script>"],
    ["% 서열이 깨졌다", "locale=%E0%A4%A"],
    ["쿠키 문자열 자체가 이상하다", ";;;=;;"],
  ])("%s — 던지지 않고 기본 언어로 떨어진다", (_name, cookie) => {
    setCookie(cookie);

    expect(() => readBrowserLocale()).not.toThrow();
    expect(readBrowserLocale()).toBe(DEFAULT_LOCALE);
  });

  /**
   * 🔴 ⑩ 서버에는 `document` 가 없다. 여기서 던지면 오류 화면이 **서버에서** 죽는다.
   * 기본 언어를 돌려주므로 `useSyncExternalStore` 의 server snapshot 과도 어긋나지 않는다.
   */
  it("document 가 없어도(SSR) 던지지 않는다", () => {
    setCookie(undefined);

    expect(() => readBrowserLocale()).not.toThrow();
    expect(readBrowserLocale()).toBe(DEFAULT_LOCALE);
  });

  it("document.cookie 를 읽는 것 자체가 던져도 기본 언어로 떨어진다", () => {
    Object.defineProperty(globalThis, "document", {
      value: {
        get cookie(): string {
          throw new Error("cookie 를 읽을 수 없다");
        },
      },
      configurable: true,
      writable: true,
    });

    expect(() => readBrowserLocale()).not.toThrow();
    expect(readBrowserLocale()).toBe(DEFAULT_LOCALE);
  });
});
