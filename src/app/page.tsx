import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DEFAULT_SECTION, sectionHref } from "@/config/navigation";
import { requireUser } from "@/lib/auth/require-workspace";
import {
  findMembership,
  listMemberWorkspaces,
} from "@/lib/auth/workspace-context";
import { readLastWorkspaceSlug } from "@/lib/workspace/last-workspace";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/** 로그인 후에만 의미가 있는 진입점이다. 공개 검색 결과에는 로그인 화면만 노출한다. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * 로그인 뒤 어디로 갈지 정하는 자리.
 *
 * ```
 * 마지막으로 보던 Workspace 가 있고 아직 소속이 살아 있으면 -> 거기로
 * 아니면                                                  -> Personal Workspace 로
 * ```
 *
 * 🔴 **「마지막 Workspace」는 편의일 뿐 권한 근거가 아니다**(스펙 16). 쿠키에서 읽은 slug 로
 * 곧장 보내지 않고 **소속을 다시 확인**한다 — 내보내진 뒤에도 그 주소가 열리면 안 된다.
 */
export default async function LandingPage() {
  const user = await requireUser();

  const remembered = await readLastWorkspaceSlug();
  if (remembered !== null) {
    const membership = await findMembership(user.id, remembered);
    if (membership !== null) {
      redirect(sectionHref(membership.slug, DEFAULT_SECTION));
    }
  }

  const workspaces = await listMemberWorkspaces(user.id);
  // 목록은 Personal 이 맨 앞이다(`listMemberWorkspaces`).
  const first = workspaces[0];
  if (first !== undefined) {
    redirect(sectionHref(first.slug, DEFAULT_SECTION));
  }

  /**
   * 여기까지 왔다는 것은 **소속이 하나도 없다**는 뜻이다.
   *
   * 정상 가입이면 로그인 이벤트가 이미 Personal Workspace 를 만들었어야 한다. 그 순간
   * Database 가 잠깐 끊겼다면 「User 는 있는데 Workspace 가 없는」 반쪽 상태가 남는다.
   * 그 사람에게 빈 화면을 보여 주는 대신 여기서 메운다 — 같은 함수라 두 번 만들지 않는다.
   */
  await ensurePersonalWorkspace({
    userId: user.id,
    displayName: user.name,
    slugSource: null,
  });

  const healed = await listMemberWorkspaces(user.id);
  const target = healed[0];

  if (target === undefined) {
    // 방금 만든 것을 곧바로 못 읽는 상황이다. 주소를 추측해서 보내지 않는다.
    throw new Error("Personal Workspace 를 만든 뒤 다시 읽지 못했다");
  }

  redirect(sectionHref(target.slug, DEFAULT_SECTION));
}
