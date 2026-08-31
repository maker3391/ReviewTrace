/**
 * 「방금 발행한 초대 링크를 아직 보여도 되는가」.
 *
 * ## 🔴 왜 순수 함수인가
 *
 * 이 판정은 화면 «그리기»가 아니라 **상태 판정**이다. 컴포넌트 안의 식으로 두면
 * 렌더러 없이는 시험할 수 없는데, 이 저장소에는 Component 시험 도구가 없고 그것 하나
 * 때문에 의존성을 늘리지 않는다. 밖으로 꺼내면 규칙만 따로 붙든다.
 *
 * 🔴 **`"use client"` 모듈에 두지 않는다.** 지시어가 붙은 파일의 export 는 Next 가
 * Client Reference Proxy 로 바꿔, Server 에서 «지금» 값을 읽는 자리에서 조용히 무너진다
 * (`ui/table.tsx` 의 열이 좁은 화면에서 뭉갠 원인이 정확히 그것이었다).
 *
 * ## 무엇이 깨져 있었는가
 *
 * ```
 * 초대 발행 -> 링크 패널이 뜬다 (Client state)
 * 그 초대 취소 -> 서버가 목록을 다시 그린다. 그런데 패널은 그대로 남는다
 * -> 이미 죽은 Token 을 「지금 복사하세요」로 권한다
 * ```
 *
 * `revalidatePath` 는 서버가 그리는 것만 되돌린다 — Client state 는 그 손이 닿지 않는다.
 */

export interface IssuedInvite {
 /** 발행된 초대 행의 id. 🔴 Token 이 아니다 — 죽은 Token 을 판정에 쓰지 않는다. */
 id: string;
 /** 사용자에게 한 번만 보여 주는 수락 주소. */
 url: string;
}

/**
 * 살아 있는 초대 목록에 그 초대가 남아 있을 때만 주소를 돌려준다.
 *
 * `liveInvitationIds` 는 **서버가 매번 다시 그리는 값**이다 — 수락됐거나 취소된 초대는
 * 그 목록에서 빠지므로, 여기서 자연히 `null` 이 된다.
 */
export function visibleInviteUrl(
 issued: IssuedInvite | null,
 liveInvitationIds: readonly string[],
): string | null {
 if (issued === null) {
 return null;
 }
 return liveInvitationIds.includes(issued.id) ? issued.url : null;
}
