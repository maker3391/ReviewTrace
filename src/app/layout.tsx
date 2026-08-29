import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_CONFIG } from "@/config/app";
import { readLocale, readTheme } from "@/lib/ui/appearance";
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

export const metadata: Metadata = {
  title: {
    default: APP_CONFIG.name,
    template: `%s · ${APP_CONFIG.name}`,
  },
  description: APP_CONFIG.description,
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
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
