import { LocaleToggle } from "@/components/molecules/LocaleToggle";
import { ThemeToggle } from "@/components/molecules/ThemeToggle";
import { messages } from "@/config/i18n";
import { readLocale, readTheme } from "@/lib/ui/appearance";

/**
 * 언어 · 테마 전환 한 쌍.
 *
 * Server Component 다 — 고른 값을 쿠키에서 읽어 **첫 응답부터 맞는 상태**로 그린다.
 *
 * 🔴 **사전을 Client 로 넘기지 않는다.** 두 Toggle 이 실제로 그리는 낱말만 골라 내려
 * 보낸다. 그 대응을 여기 한 곳에 두어 상단 바와 로그인 화면이 갈라지지 않게 한다.
 */
export async function AppearanceControls() {
  const [locale, theme] = await Promise.all([readLocale(), readTheme()]);
  const t = messages(locale).appearance;

  return (
    <div className="flex items-center gap-0.5">
      <LocaleToggle
        locale={locale}
        labels={{ language: t.language, ko: t.localeKo, en: t.localeEn }}
      />
      <ThemeToggle
        theme={theme}
        labels={{
          theme: t.theme,
          light: t.themeLight,
          dark: t.themeDark,
          system: t.themeSystem,
        }}
      />
    </div>
  );
}
