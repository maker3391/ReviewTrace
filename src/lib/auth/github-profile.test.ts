import { describe, expect, it } from "vitest";

import type { GitHubProfile } from "next-auth/providers/github";

import { githubProfileToUser } from "@/lib/auth/github-profile";

/**
 * OAuth 가입 경계의 Email.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * `users.email` 을 채우는 자리는 이 함수 하나뿐이고, Auth.js 는 **여기서 나온 값 그대로**
 * 기존 계정을 찾고(`getUserByEmail` -> `eq(users.email, ?)`) 없으면 만든다(`createUser`).
 * 정규화가 빠지면 `User@Example.com` 과 `user@example.com` 이 **서로 다른 ReviewTrace
 * 계정**이 되고, `users_email_unique` 는 그 둘을 다른 값으로 보므로 막지 못한다.
 *
 * ## 여기서 보지 «않는» 것
 *
 * Adapter 가 실제로 그 값으로 행을 만드는가, unique index 가 실제로 걸려 있는가 —
 * 둘 다 Database 와 라이브러리가 지키는 것이라 통합시험·실제 로그인의 몫이다.
 * 여기서는 **우리가 무엇을 넘기는가**만 본다.
 */
function profile(over: Partial<GitHubProfile> = {}): GitHubProfile {
  return {
    id: 12345,
    login: "Maker3391",
    name: "사장님",
    email: "user@example.com",
    avatar_url: "https://example.test/a.png",
    ...over,
  } as GitHubProfile;
}

describe("githubProfileToUser", () => {
  it("이메일을 정규 형태로 넘긴다", () => {
    expect(githubProfileToUser(profile({ email: "  User@Example.COM " })).email).toBe(
      "user@example.com",
    );
  });

  /**
   * 🔴 **이 파일의 핵심.** 같은 사람이 대소문자만 다르게 와도 Auth.js 가 던지는 조회 값이
   * 같아야 한다 — 다르면 `getUserByEmail` 이 기존 계정을 못 찾고 계정을 하나 더 만든다.
   */
  it("🔴 대소문자만 다른 GitHub 프로필은 «같은 계정»을 가리킨다", () => {
    const upper = githubProfileToUser(profile({ email: "User@Example.com" }));
    const lower = githubProfileToUser(profile({ email: "user@example.com" }));

    expect(upper.email).toBe(lower.email);
  });

  /**
   * 이메일을 비공개로 둔 사용자의 대체 주소에도 `login` 이 그대로 들어간다.
   * GitHub 아이디는 대문자를 가질 수 있어(`Maker3391`) 이 자리를 빠뜨리면
   * **이메일을 공개하지 않은 사용자만** 갈라진다.
   */
  it("🔴 이메일이 없을 때 만드는 noreply 주소도 정규 형태다", () => {
    const user = githubProfileToUser(profile({ email: null }));

    expect(user.email).toBe("12345+maker3391@users.noreply.github.com");
  });

  it("이메일이 없어도 계정마다 다른 값이 된다 — NOT NULL·unique 를 지킨다", () => {
    const a = githubProfileToUser(profile({ id: 1, login: "a", email: null }));
    const b = githubProfileToUser(profile({ id: 2, login: "b", email: null }));

    expect(a.email).not.toBe(b.email);
    expect(a.email).toBeTruthy();
  });

  it("이름이 없으면 GitHub 아이디를 쓴다", () => {
    expect(githubProfileToUser(profile({ name: null })).name).toBe("Maker3391");
  });

  /** 🔴 Provider Token 을 담지 않는다 — 담으면 세션 조회로 브라우저까지 나간다. */
  it("🔴 프로필 네 칸만 넘긴다 — Token 이 실리지 않는다", () => {
    expect(Object.keys(githubProfileToUser(profile())).sort()).toEqual([
      "email",
      "id",
      "image",
      "name",
    ]);
  });
});
