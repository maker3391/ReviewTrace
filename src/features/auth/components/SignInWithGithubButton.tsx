import { Button } from "@/components/ui/button";
import { signInWithGithubAction } from "@/features/auth/actions/sign-in";

/**
 * GitHub 로그인 버튼.
 *
 * Server Component 다 — 누르면 Server Action 하나가 도는 폼이라 `'use client'` 가 필요 없다.
 *
 * `redirectTo` 는 로그인 뒤 돌아올 경로다. 🔴 값은 서버에서 다시 검증한다
 * (`signInWithGithubAction`) — 폼에 담긴 것은 브라우저에서 고칠 수 있다.
 */
export function SignInWithGithubButton({
  redirectTo = "/",
  className,
}: {
  redirectTo?: string;
  className?: string;
}) {
  return (
    <form action={signInWithGithubAction} className={className}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Button type="submit" className="w-full">
        GitHub 으로 로그인
      </Button>
    </form>
  );
}
