import "server-only";

import { cache } from "react";

import { auth } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth/workspace-context";

/**
 * 세션에서 「누구인가」를 읽는 자리.
 *
 * 🔴 **Workspace 조회(`workspace-context.ts`)와 파일을 나눈 이유가 있다.** 그쪽은 순수한
 * Database 질의라 Workspace 하나 없이도 시험할 수 있어야 하는데, 여기서 부르는 `auth()` 는
 * Next.js 런타임을 끌고 온다. 한 파일에 두면 Tenant 격리 시험이 인증 라이브러리를 통째로
 * 적재해야 한다.
 */

/**
 * 로그인한 사용자. 없으면 `null`.
 *
 * `cache` 는 React 렌더 한 번의 범위다 — Layout·화면·조회가 각각 불러도 세션 조회는 한 번만
 * 돈다. 요청 사이에 값이 넘어가지 않는다.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;

  if (typeof id !== "string" || id === "") {
    return null;
  }

  // 🔴 세션 객체를 그대로 넘기지 않는다. 화면이 그리는 칸만 옮긴다(CLAUDE.md 11).
  return {
    id,
    name: session?.user?.name ?? null,
    image: session?.user?.image ?? null,
  };
});
