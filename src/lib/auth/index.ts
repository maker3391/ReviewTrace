import "server-only";

import NextAuth from "next-auth";

import { buildAuthConfig } from "@/lib/auth/config";

/**
 * Auth.js 진입점.
 *
 * 설정을 **함수로** 넘긴다 — 요청이 올 때 평가되므로 이 모듈을 import 하는 것만으로는
 * 환경 변수를 요구하지 않는다(`src/lib/auth/config.ts` 참고).
 *
 * - `auth()`  현재 세션. Server Component·Server Action·Route Handler 에서 쓴다
 * - `signIn` / `signOut`  Server Action 안에서만 부른다. 브라우저가 직접 부르지 않는다
 * - `handlers`  `/api/auth/*` Route Handler
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() =>
  buildAuthConfig(),
);
