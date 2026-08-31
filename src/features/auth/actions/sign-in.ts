"use server";

import { signIn } from "@/lib/auth";

/**
 * GitHub 로그인 시작.
 *
 * Server Action 이다 — 브라우저가 Auth.js Endpoint 를 직접 부르지 않는다.
 * 성공하면 GitHub 으로 redirect 되고, 이 함수는 값을 돌려주지 않는다.
 *
 * 🔴 실패는 `ActionResult` 로 돌려주지 않는다. 여기서 일어날 수 있는 실패는 「설정이 잘못됐다」
 * 뿐이고, 그때 Auth.js 가 `/login?error=...` 로 되돌려 보낸다 — 화면이 읽어야 할 결과가 없다.
 */
export async function signInWithGithubAction(formData: FormData): Promise<void> {
 const raw = formData.get("redirectTo");

 /**
 * 🔴 **돌아갈 곳을 사용자 입력에서 그대로 받지 않는다.**
 *
 * 이 값은 폼에 담겨 오므로 브라우저에서 고칠 수 있다. `//evil.example` 같은 값을 그대로
 * 넘기면 로그인 직후 남의 사이트로 보내진다(Open Redirect). **우리 사이트 안의 절대 경로**
 * 하나만 통과시킨다 — `//` 로 시작하면 프로토콜 상대 URL 이라 밖으로 나간다.
 */
 const redirectTo =
 typeof raw === "string" && /^\/(?!\/)[\w\-./[\]]*$/.test(raw) ? raw : "/";

 await signIn("github", { redirectTo });
}
