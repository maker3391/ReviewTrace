import type { Metadata } from "next";

import { AcceptInvitationForm } from "@/features/invitations/components/AcceptInvitationForm";
import { invitationTokenSchema } from "@/features/invitations/schemas/invitation";
import { findInvitationPreview } from "@/features/invitations/server/invitation-service";
import { currentUser } from "@/lib/auth/workspace-context";
import { SignInWithGithubButton } from "@/features/auth/components/SignInWithGithubButton";

export const metadata: Metadata = {
  title: "초대",
};

/**
 * 초대 수락 화면.
 *
 * 🔴 **공개 경로다.** 아직 회원이 아닌 사람도 이 링크를 열 수 있어야 한다(스펙 9).
 * 「공개」는 세션 검사를 건너뛴다는 뜻일 뿐이고, 자격 증명은 **주소에 담긴 Token** 이다.
 *
 * 🔴 **링크를 주운 사람에게 Workspace 내부를 보여 주지 않는다.** 이름과 초대 대상 이메일까지다.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const parsed = invitationTokenSchema.safeParse(token);

  // 형식이 아니면 Database 를 보지도 않는다.
  const validToken = parsed.success ? parsed.data : null;
  const preview =
    validToken === null ? null : await findInvitationPreview(validToken);

  if (validToken === null || preview === null) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-base font-semibold tracking-tight">
          사용할 수 없는 초대
        </h1>
        <p className="text-xs text-muted-foreground">
          링크가 만료됐거나 이미 사용됐습니다. 초대한 사람에게 다시 요청하세요.
        </p>
      </div>
    );
  }

  const user = await currentUser();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-base font-semibold tracking-tight">
          {preview.workspaceName} 초대
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {preview.email} 로 초대받았습니다. 수락하면 이 Workspace 의 멤버가 됩니다.
        </p>
      </div>

      {user === null ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            먼저 GitHub 으로 로그인하세요. 로그인하면 이 화면으로 돌아옵니다.
          </p>
          {/* 로그인 뒤 이 초대 화면으로 되돌아온다 — 그래야 수락 버튼을 다시 찾지 않는다. */}
          <SignInWithGithubButton redirectTo={`/invite/${validToken}`} />
        </div>
      ) : (
        <AcceptInvitationForm token={validToken} />
      )}
    </div>
  );
}
