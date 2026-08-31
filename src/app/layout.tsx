import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_CONFIG } from "@/config/app";
import { readLocale, readTheme } from "@/lib/ui/appearance";
import { LocaleProvider } from "@/lib/ui/locale-context";
import { SYSTEM_THEME_SCRIPT, themeClassName } from "@/lib/ui/theme";
import { cn } from "@/lib/utils";

import "./globals.css";

// globals.css 의 @theme 가 --font-sans / --font-geist-mono 를 본다. 이름을 맞춘다.
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 한글 본문.
 *
 * 🔴 **Geist 에는 한글 글리프가 없다.** 그래서 지금까지 한국어는 «고른 적 없는» 브라우저
 * 기본 대체 폰트로 그려졌다 — 굵기가 안 맞고 라틴과 겉돌아 화면이 얇고 싸게 보인 진짜
 * 원인이다(실측: 같은 문자열이 Geist 147px, 시스템 대체 160px).
 *
 * 🔴 **Latin 을 밀어내지 않는다.** stack 에서 Geist «뒤»에 두면 브라우저가 글자마다
 * 글리프가 있는 첫 폰트를 쓴다 — 라틴은 Geist, 한글은 이것.
 *
 * 🔴 **런타임에 외부로 나가지 않는다.** next/font 가 빌드 때 받아 자체 호스팅한다.
 */
const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(APP_CONFIG.url),
  title: {
    default: APP_CONFIG.name,
    template: `%s · ${APP_CONFIG.name}`,
  },
  description: APP_CONFIG.description,
  verification: {
    other: {
      "naver-site-verification":
        "0ac9ac3684016c79bf8d5852c04d93e95b120ce3",
    },
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: APP_CONFIG.name,
    title: APP_CONFIG.name,
    description: APP_CONFIG.description,
  },
};

/**
 * 🔴 **테마와 언어는 «서버가» 정해 내보낸다.**
 *
 * 쿠키가 요청과 함께 오므로 첫 응답의 `<html>` 이 이미 맞는 class 와 `lang` 을 갖는다 —
 * 브라우저가 JS 를 실행한 뒤에 고치면 새로고침마다 흰 화면이 한 번 번쩍인다
 * (`lib/ui/theme.ts` · `config/i18n.ts`).
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, theme] = await Promise.all([readLocale(), readTheme()]);

  return (
    <html
      lang={locale}
      /*
        🔴 `system` 일 때만 아래 스크립트가 class 를 더한다 — 그 순간 서버가 그린 것과
        달라지므로 React 가 불일치를 경고한다. 「테마는 브라우저에서 결정된다」는 것이
        의도된 동작이라 이 한 요소에서만 경고를 끈다.
      */
      suppressHydrationWarning
      className={cn(
        geistSans.variable,
        geistMono.variable,
        notoSansKr.variable,
        "h-full antialiased",
        themeClassName(theme),
      )}
    >
      <body className="flex min-h-full flex-col">
        {/*
          🔴 **맨 앞에서 동기로 돈다.** 뒤따르는 내용이 파싱되기 전에 끝나므로 밝은 화면이
          한 번 그려졌다가 어두워지는 일이 없다. `useEffect` 로는 늦다.

          테마를 «고른» 사람에게는 아예 나가지 않는다 — 서버가 이미 맞는 class 를 붙였다.
        */}
        {theme === "system" && (
          <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
        )}
        {/*
          🔴 **사전이 아니라 «언어 두 글자»만 내려간다.** 서버가 그린 `<html lang>` 과 같은
          값이라 첫 클라이언트 렌더가 어긋나지 않는다. prop 을 받을 수 없는 자리
          (`error.tsx`)와 브라우저에서 도는 Zod 검증이 이것을 본다(`lib/ui/locale-context.tsx`).
        */}
        <LocaleProvider locale={locale}>
          <TooltipProvider>{children}</TooltipProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
