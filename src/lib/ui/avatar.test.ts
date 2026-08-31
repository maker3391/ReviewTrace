import { describe, expect, it } from "vitest";

import { avatarSources } from "@/lib/ui/avatar";

/**
 * Header 아바타 화질의 회귀 시험.
 *
 * 🔴 **실제로 나가는 «URL 문자열»을 고정한다.** 이 규칙이 조용히 사라지면 화면은
 * 여전히 그려지고 아무 오류도 나지 않는다 — 아바타만 다시 뭉개진다. 그런 결함은
 * 타입도 빌드도 잡지 못하므로 문자열 자체를 시험이 붙들고 있어야 한다.
 */

/** 세션에 실제로 담기는 모양 — `githubProfileToUser` 가 넘기는 `avatar_url` 원문이다. */
const GITHUB_AVATAR = "https://avatars.githubusercontent.com/u/583231?v=4";

/** Header 가 그리는 크기(`size-[26px]`). */
const RENDER_PX = 26;

describe("avatarSources", () => {
  it("표시 크기의 1x·2x·3x 후보를 srcSet 으로 낸다", () => {
    const { src, srcSet } = avatarSources(GITHUB_AVATAR, RENDER_PX);

    // srcSet 을 모르는 클라이언트도 2배 해상도를 받는다.
    expect(src).toBe("https://avatars.githubusercontent.com/u/583231?v=4&s=52");
    expect(srcSet).toBe(
      [
        "https://avatars.githubusercontent.com/u/583231?v=4&s=26 1x",
        "https://avatars.githubusercontent.com/u/583231?v=4&s=52 2x",
        "https://avatars.githubusercontent.com/u/583231?v=4&s=78 3x",
      ].join(", "),
    );
  });

  it("크기를 지정하지 않은 원본 URL 을 그대로 내보내지 않는다", () => {
    const { src, srcSet } = avatarSources(GITHUB_AVATAR, RENDER_PX);

    // 크기 인자가 없으면 460×460 원본이 와서 브라우저가 17.7배를 줄인다.
    expect(src).not.toBe(GITHUB_AVATAR);
    expect(srcSet).not.toContain(`${GITHUB_AVATAR} `);
  });

  it("이미 붙어 있는 작은 크기 인자를 덮어쓴다", () => {
    // 🔴 덧붙이기만 하면 `?s=32&s=52` 가 되어 앞의 값이 이긴다.
    const { src } = avatarSources(
      "https://avatars.githubusercontent.com/u/583231?v=4&s=32",
      RENDER_PX,
    );

    expect(src).toBe("https://avatars.githubusercontent.com/u/583231?v=4&s=52");
    expect(src).not.toContain("s=32");
  });

  it("별칭인 size 인자도 함께 걷어낸다", () => {
    const { src } = avatarSources(
      "https://avatars.githubusercontent.com/u/583231?size=32",
      RENDER_PX,
    );

    expect(src).toBe("https://avatars.githubusercontent.com/u/583231?s=52");
    expect(src).not.toContain("size=");
  });

  it("GitHub 아바타가 아니면 손대지 않는다", () => {
    // 다른 Provider·Gravatar 는 `s` 를 모른다. 임의로 붙이면 오히려 깨진다.
    const other = "https://www.gravatar.com/avatar/abc";
    const { src, srcSet } = avatarSources(other, RENDER_PX);

    expect(src).toBe(other);
    expect(srcSet).toBeUndefined();
  });

  it("URL 로 읽히지 않는 값에도 던지지 않는다", () => {
    // 🔴 여기서 던지면 Header 가 통째로 죽는다.
    const broken = "not a url";
    const { src, srcSet } = avatarSources(broken, RENDER_PX);

    expect(src).toBe(broken);
    expect(srcSet).toBeUndefined();
  });

  it("표시 크기가 달라지면 후보도 함께 커진다", () => {
    const { src, srcSet } = avatarSources(GITHUB_AVATAR, 64);

    expect(src).toContain("s=128");
    expect(srcSet).toContain("s=64 1x");
    expect(srcSet).toContain("s=192 3x");
  });
});
