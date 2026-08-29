"use server";

import { redirect } from "next/navigation";

import { DEFAULT_SECTION, sectionHref } from "@/config/navigation";
import { invitationTokenSchema } from "@/features/invitations/schemas/invitation";
import { acceptInvitation } from "@/features/invitations/server/invitation-service";
import { requireUser } from "@/lib/auth/require-workspace";
import { actionFromError } from "@/lib/action/action-error";
import type { ActionResult } from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";

/**
 * 초대 수락.
 *
 * 로그인하지 않았으면 `requireUser` 가 로그인 화면으로 보낸다 — 돌아올 곳은 초대 화면이다.
 *
 * 🔴 **초대받은 이메일과 로그인한 계정이 달라도 수락을 막지 않는다.** 초대 링크 자체가
 * 자격 증명이고(추측할 수 없는 256bit 난수), GitHub 은 이메일을 비공개로 둘 수 있어
 * 우리가 아는 주소와 사람이 쓰는 주소가 다를 수 있다. 이메일 일치를 조건으로 걸면
 * **정상 사용자가 자기 초대를 못 쓰는** 일이 훨씬 자주 생긴다.
 */
export async function acceptInvitationAction(
  rawToken: string,
): Promise<ActionResult<never>> {
  /*
    🔴 문구를 여기 적지 않는다 — 화면 언어를 따라야 한다. Schema 는 형식만 알고
    (`invitation.ts`), 말은 사전이 갖는다(`config/messages`).
  */
  const parsed = await parseActionInput(
    invitationTokenSchema,
    rawToken,
    (validation) => validation.rules.invitationToken,
  );
  if (!parsed.ok) {
    return parsed.failure;
  }

  let slug: string;
  try {
    const user = await requireUser();
    slug = await acceptInvitation({ token: parsed.data, userId: user.id });
  } catch (error) {
    return actionFromError(error);
  }

  // 🔴 redirect 는 예외로 흐름을 끊는다. try 안에서 부르면 위 catch 가 그것을 삼킨다.
  redirect(sectionHref(slug, DEFAULT_SECTION));
}
