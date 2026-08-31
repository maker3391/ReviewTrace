import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions/sign-out";
import { readMessages } from "@/lib/ui/appearance";

/**
 * 로그아웃 버튼.
 *
 * Server Component 다 — 눌렀을 때 하는 일이 Server Action 하나뿐이라 `'use client'` 가 필요 없다.
 * 상호작용이 있다는 이유만으로 Client Component 로 내리지 않는다.
 */
export async function SignOutButton() {
 const t = (await readMessages()).nav;

 return (
 <form action={signOutAction} className="w-full">
 <Button
 type="submit"
 size="sm"
 variant="ghost"
 className="h-8 w-full justify-start font-normal"
 >
 {t.signOut}
 </Button>
 </form>
);
}
