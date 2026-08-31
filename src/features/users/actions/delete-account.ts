"use server";

import { deleteAccount } from "@/features/users/server/account-deletion-service";
import { actionFromError } from "@/lib/action/action-error";
import {
 actionOk,
 type ActionResult,
} from "@/lib/action/action-result";
import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/auth/require-workspace";

/**
 * 계정 삭제.
 *
 * 🔴 **인자를 하나도 받지 않는다.** 지울 대상은 세션이 정한다 — 화면이 `userId` 를 보낼 수
 * 있게 두면 그 자리가 곧바로 「남의 계정 삭제」가 된다. 이 서명이 그것을
 * **문법 수준에서** 막는다.
 *
 * Server Action 은 Transport 다 — 누구인지 확인하고, Application Service 를
 * 부르고, 실패를 화면이 읽을 수 있는 형태로 돌려주는 것까지다. 무엇을 지우고 무엇을 남길지는
 * `account-deletion-service.ts` 가 정한다.
 */
export async function deleteAccountAction(): Promise<ActionResult> {
 try {
 const user = await requireUser();

 await deleteAccount({ userId: user.id });

 /**
 * 계정이 사라졌으니 브라우저의 세션 쿠키는 **가리키는 곳이 없는 값**이다.
 * 남겨 두어도 로그인 상태가 되지는 않지만(행이 없다) 그대로 두지 않는다.
 *
 * 🔴 `redirect: false` 다 — 여기서 이동까지 하면 `NEXT_REDIRECT` 예외가 아래
 * `catch` 에 걸려 **성공한 삭제가 실패로 보고된다.** 이동은 화면이 한다.
 */
 try {
 await signOut({ redirect: false });
 } catch {
 // 🔴 쿠키를 지우지 못한 것으로 «이미 끝난 삭제»를 실패로 만들지 않는다.
 }

 return actionOk();
 } catch (error) {
 return actionFromError(error);
 }
}
