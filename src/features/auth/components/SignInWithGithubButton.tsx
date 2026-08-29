import { Button } from "@/components/ui/button";
import { GithubMark } from "@/features/auth/components/GithubMark";
import { signInWithGithubAction } from "@/features/auth/actions/sign-in";
import { readMessages } from "@/lib/ui/appearance";

/**
 * GitHub 로그인 버튼.
 *
 * Server Component 다 — 누르면 Server Action 하나가 도는 폼이라 `'use client'` 가 필요 없다.
 *
 * `redirectTo` 는 로그인 뒤 돌아올 경로다. 🔴 값은 서버에서 다시 검증한다
 * (`signInWithGithubAction`) — 폼에 담긴 것은 브라우저에서 고칠 수 있다.
 *
 * 🔴 **ReviewTrace 의 Brand 색을 쓰지 않는다.** 이것은 우리 CTA 가 아니라 GitHub 으로
 * 가는 문이다 — indigo 로 칠하면 제품 버튼처럼 읽혀 «무엇으로» 로그인하는지 흐려진다.
 * `bg-foreground text-background` 는 Light 에서 GitHub 계열의 검정 CTA 가 되고 Dark 에서는
 * 밝은 CTA 가 된다. 색을 박지 않고 토큰을 뒤집는 것이라 테마가 바뀌어도 대비가 유지된다.
 *
 * 이 화면의 **유일한 Primary Action** 이라 `size="lg"` 로 둔다 — 다른 화면의 촘촘한
 * 도구 버튼과 같은 높이면 「눌러야 할 것」으로 읽히지 않는다(CLAUDE.md 16).
 * Focus ring·keyboard 동작은 `Button` primitive 가 그대로 갖는다.
 */
export async function SignInWithGithubButton({
  redirectTo = "/",
  className,
}: {
  redirectTo?: string;
  className?: string;
}) {
  const t = (await readMessages()).login;

  return (
    <form action={signInWithGithubAction} className={className}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Button
        type="submit"
        size="lg"
        className="w-full gap-2.5 bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-foreground/30"
      >
        <GithubMark className="size-[18px]" />
        {t.continueWithGithub}
      </Button>
    </form>
  );
}
