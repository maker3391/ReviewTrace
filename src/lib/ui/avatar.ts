/**
 * 프로필 이미지를 «표시 크기에 맞는 해상도»로 받게 만드는 자리.
 *
 * ## 무엇이 문제였나
 *
 * 세션의 `image` 는 GitHub OAuth 프로필의 `avatar_url` 원문이다
 * (`src/lib/auth/github-profile.ts`) — 크기 지정이 없는
 * `https://avatars.githubusercontent.com/u/{id}?v=4` 꼴이다.
 *
 * 그 URL 은 **원본을 그대로** 돌려준다(실측: 460×460 · 26,186 B). Header 의 아바타는
 * 26 CSS px 이라 브라우저가 **17.7배**를 한 번에 줄인다. 크게 줄일수록 브라우저의 축소
 * 필터가 거칠어져 사진 아바타의 가장자리가 계단처럼 남는다 — 「저해상도로 보인다」의 실체다.
 * 게다가 아이콘 하나에 26 KB 를 내려받는다.
 *
 * 🔴 **반대 방향의 위험도 같이 막는다.** 저장된 값에 `?s=32` 같은 작은 크기가 이미 붙어
 * 있으면 고해상도 화면에서 두 배로 늘어나 뭉개진다. 그래서 이 함수는 크기 인자를
 * **덧붙이지 않고 «덮어쓴다»** — 어느 쪽이 저장돼 있든 결과가 같다.
 *
 * ## 왜 여기서 고치고 저장 시점에서 고치지 않나
 *
 * `githubProfileToUser` 가 `?s=` 를 붙여 저장하면 **표시 크기라는 화면의 결정이 Database
 * 행에 굳는다.** Header 가 26px 을 쓰다 다른 자리에서 64px 을 쓰는 순간 답이 없고, 이미
 * 저장된 행은 다시 로그인하기 전까지 바뀌지 않는다. 크기는 그리는 쪽이 안다.
 *
 * ## 왜 `next/image` 가 아닌가
 *
 * 외부 도메인이라 `next.config.ts` 에 `images.remotePatterns` 를 열어야 하고, 그러면
 * 우리 서버가 GitHub 이미지를 대신 받아 다시 내보내는 최적화 경로가 붙는다. GitHub 의
 * 아바타 CDN 이 **이미 크기별 리사이즈를 제공**하므로 그 파이프라인이 하는 일을 한 번 더
 * 하는 셈이다. 필요한 것은 「DPR 별로 다른 크기를 고르게 하는 것」뿐이고,
 * 그건 `srcSet` 한 줄이다.
 */

/** GitHub 아바타 CDN. 이 host 일 때만 크기 인자를 다룬다. */
const GITHUB_AVATAR_HOST = "avatars.githubusercontent.com";

/**
 * GitHub 이 크기를 읽는 Query 이름. `s` 가 정본이고 `size` 는 별칭이다.
 * 🔴 덮어쓸 때 **둘 다** 손대야 한다 — `size` 를 남겨 두면 그쪽이 이기는 경우가 생긴다.
 */
const SIZE_PARAMS = ["s", "size"] as const;

/**
 * 어떤 배율까지 준비하는가.
 *
 * 1x 는 표시 크기와 «정확히» 같아 픽셀이 1:1 로 맞는다(가장 선명하고 가장 가볍다).
 * 2x·3x 는 Retina 와 Windows 배율 확대(125%·150% → devicePixelRatio 1.25·1.5)를 덮는다 —
 * 브라우저는 자기 DPR 이상인 **가장 작은** 후보를 고르므로 1.25 배 화면은 2x 를 받는다.
 */
const DEVICE_PIXEL_RATIOS = [1, 2, 3] as const;

export type AvatarSources = {
  /** `srcSet` 을 모르는 클라이언트가 받을 값. 표시 크기의 2배로 둔다. */
  src: string;
  /** DPR 별 후보. GitHub 아바타가 아니면 `undefined` — 그때는 원본 그대로 쓴다. */
  srcSet?: string;
};

/**
 * 표시 크기(CSS px)에 맞는 아바타 URL 들을 만든다.
 *
 * GitHub 아바타가 아니거나 URL 로 읽히지 않으면 **받은 값을 그대로** 돌려준다.
 * 🔴 여기서 던지면 Header 가 통째로 죽는다 — 알아보지 못하는 값은 손대지 않고 지나간다.
 */
export function avatarSources(image: string, renderPx: number): AvatarSources {
  let url: URL;

  try {
    url = new URL(image);
  } catch {
    return { src: image };
  }

  if (url.protocol !== "https:" || url.hostname !== GITHUB_AVATAR_HOST) {
    return { src: image };
  }

  const at = (dpr: number): string => {
    const sized = new URL(url);
    for (const param of SIZE_PARAMS) {
      sized.searchParams.delete(param);
    }
    sized.searchParams.set("s", String(Math.round(renderPx * dpr)));
    return sized.toString();
  };

  return {
    src: at(2),
    srcSet: DEVICE_PIXEL_RATIOS.map((dpr) => `${at(dpr)} ${dpr}x`).join(", "),
  };
}
