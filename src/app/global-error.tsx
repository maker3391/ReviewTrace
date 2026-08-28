"use client";

/**
 * Root Layout 자체가 깨졌을 때의 마지막 방어선.
 *
 * 자기 <html>·<body> 를 직접 그린다 — 이 자리에서는 Layout 이 이미 없다.
 * 전역 스타일도 닿지 않으므로 Tailwind 클래스에 기대지 않고 최소한의 inline style 만 쓴다.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="ko">
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
          화면을 불러오지 못했습니다.
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
          다시 시도
        </button>
      </body>
    </html>
  );
}
