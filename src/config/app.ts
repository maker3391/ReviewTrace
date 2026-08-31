/**
 * 화면·메타데이터에 쓰는 애플리케이션 상수. 환경에 따라 달라지는 값은 여기 두지 않는다.
 *
 * 🔴 **제품명이 사는 자리는 여기 하나다.** 화면(`AppHeader`·로그인)과 메타데이터
 * (`app/layout.tsx`)가 전부 이 상수를 본다 — 이름이 바뀌면 이 파일만 고친다.
 *
 * 🔴 **표기는 `ReviewTrace` 하나다.** `Review Trace` · `Reviewtrace` · `REVIEWTRACE` 를
 * 쓰지 않는다.
 */
export const APP_CONFIG = {
 name: "ReviewTrace",
 /**
 * Tagline.
 *
 * 🔴 **모든 화면에 반복해서 노출하지 않는다.** 제품을 처음 만나는 자리
 * (로그인 화면)에만 둔다. 상단 바나 사이드바에 또 적으면 장식이 된다.
 */
 tagline: "Review. Resolve. Remember.",
 description:
 "External Coding Agent 의 Review 결과를 모아 Finding → Fix Attempt → Verification → Resolution 이력을 축적하는 Developer Review Memory System",
} as const;
