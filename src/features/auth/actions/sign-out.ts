"use server";

import { LOGIN_PATH } from "@/config/routes";
import { signOut } from "@/lib/auth";

/**
 * 로그아웃.
 *
 * Database 세션이라 `sessions` 행이 지워진다 — 쿠키만 버리는 것이 아니라 **그 즉시** 끝난다.
 * 끝난 뒤에는 로그인 화면으로 보낸다. 그대로 두면 보호된 화면에서 리다이렉트가 한 번 더 돈다.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: LOGIN_PATH });
}
