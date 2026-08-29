"use client";

import { useSyncExternalStore } from "react";

import { DEFAULT_LOCALE, messages } from "@/config/i18n";
import { readBrowserLocale } from "@/lib/ui/browser-locale";

/**
 * Root Layout 자체가 깨졌을 때의 마지막 방어선.
 *
 * 자기 <html>·<body> 를 직접 그린다 — 이 자리에서는 Layout 이 이미 없다.
 * 전역 스타일도 닿지 않으므로 Tailwind 클래스에 기대지 않고 최소한의 inline style 만 쓴다.
 *
 * ## 🔴 `error.tsx` 와 사정이 다르다
 *
 * ```text
 * error.tsx         Root Layout «안»  -> Layout 이 내려 준 Context 로 언어를 안다
 * global-error.tsx  Root Layout «대신» -> Provider 가 없다. 쿠키를 직접 읽는다
 * ```
 *
 * ## 🔴 그런데 렌더 중에 그냥 읽으면 안 된다
 *
 * 이 화면도 서버에서 한 번 그려질 수 있고, 서버에는 `document` 가 없다. 렌더에서 바로
 * 읽으면 서버는 늘 기본 언어로, 브라우저는 실제 언어로 그려 **hydration 이 어긋난다.**
 *
 * 그래서 `useSyncExternalStore` 로 읽는다 — React 가 **서버·hydration 때는
 * `getServerSnapshot`**(기본 언어)을, 붙고 난 뒤에는 **`getSnapshot`**(실제 쿠키)을 쓴다.
 * 서버가 그린 것과 첫 클라이언트 렌더가 언제나 같고, 그 뒤에 조용히 제 언어로 바뀐다.
 * `useEffect` + `setState` 로 흉내내면 같은 그림이 되면서 렌더가 한 번 더 돈다.
 *
 * 🔴 **여기서 실패하면 사용자에게 남는 것은 빈 화면뿐이다.** `readBrowserLocale` 은
 * 던지지 않고, 쿠키가 없거나 깨졌으면 기본 언어로 떨어진다.
 */

/** 언어 쿠키는 이 화면이 떠 있는 동안 바뀌지 않는다 — 구독할 것이 없다. */
const NO_SUBSCRIBE = () => () => {};
const SERVER_LOCALE = () => DEFAULT_LOCALE;
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const locale = useSyncExternalStore(
    NO_SUBSCRIBE,
    readBrowserLocale,
    SERVER_LOCALE,
  );

  const t = messages(locale).errorPage;

  return (
    <html lang={locale}>
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
        }}
      >
        <p style={{ fontSize: "0.875rem", fontWeight: 500 }}>
          {t.globalGeneric}
        </p>
        {error.digest !== undefined && (
          <code style={{ fontSize: "0.75rem", opacity: 0.6 }}>
            {error.digest}
          </code>
        )}
        <button
          type="button"
          onClick={() => retry()}
          style={{
            border: "1px solid currentColor",
            borderRadius: "0.375rem",
            padding: "0.25rem 0.75rem",
            fontSize: "0.875rem",
          }}
        >
          {t.retry}
        </button>
      </body>
    </html>
  );
}
