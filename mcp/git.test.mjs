import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  parseRemote,
  readRepositoryContext,
  repositoryFromFullName,
} from "./git.mjs";

const run = promisify(execFile);

/**
 * 🔴 이 시험이 지키는 것은 **「GitHub 이 아닌 곳을 GitHub 이라고 적지 않는다」** 이다.
 *
 * 되돌림 확인: 호스트 비교를 `host.endsWith("github.com")` 로 되돌리면
 * 「접두가 겹치기만 한 호스트를 GitHub 으로 착각하지 않는다」가 실패한다. 직접 확인했다.
 *
 * 이 결함은 실제로 있었다 — `notgithub.com` 이 통과해 그 저장소가 GitHub 저장소로
 * 저장됐고, 이후 Evidence 확인은 `api.github.com/{owner}/{name}` 을 보게 된다.
 * **실제 remote 와 다른 저장소의 코드가 근거로 적힌다.**
 */
describe("parseRemote", () => {
  it("SSH·HTTPS 둘 다에서 owner/name 을 읽는다", () => {
    expect(parseRemote("git@github.com:acme/app.git")).toMatchObject({
      provider: "GITHUB",
      owner: "acme",
      name: "app",
    });
    expect(parseRemote("https://github.com/acme/app.git")).toMatchObject({
      owner: "acme",
      name: "app",
    });
    expect(parseRemote("ssh://git@github.com/acme/app")).toMatchObject({
      owner: "acme",
      name: "app",
    });
  });

  it("🔴 접두가 겹치기만 한 호스트를 GitHub 으로 착각하지 않는다", () => {
    expect(parseRemote("git@notgithub.com:tenant/private.git")).toBeNull();
    expect(parseRemote("https://evil-github.com/acme/app")).toBeNull();
    expect(parseRemote("https://github.com.attacker.net/acme/app")).toBeNull();
  });

  it("🔴 GitHub Enterprise 하위 도메인도 «지금은» 거절한다", () => {
    /**
     * host 를 Repository 모델에 싣지 않으므로, Evidence 확인은 서버 설정의
     * `GITHUB_API_URL`(기본 public GitHub)을 본다 — Enterprise 저장소의 근거가
     * **public GitHub 의 같은 이름 저장소**와 대조돼 VERIFIED 가 될 수 있다.
     * host 를 실어 나르게 되면 그때 열어야 한다.
     */
    expect(parseRemote("git@ghe.github.com:acme/app.git")).toBeNull();
  });

  it("GitHub 이 아닌 Provider 는 거절한다 — 지금 저장할 수 있는 것은 GitHub 뿐이다", () => {
    expect(parseRemote("git@gitlab.com:acme/app.git")).toBeNull();
    expect(parseRemote("https://bitbucket.org/acme/app")).toBeNull();
  });

  it("owner/name 을 못 읽으면 null 이다", () => {
    expect(parseRemote("https://github.com/acme")).toBeNull();
    expect(parseRemote("그냥 문자열")).toBeNull();
  });
});

describe("repositoryFromFullName", () => {
  it("owner/name 모양만 받는다", () => {
    expect(repositoryFromFullName("acme/app")).toMatchObject({
      provider: "GITHUB",
      owner: "acme",
      name: "app",
      fullName: "acme/app",
    });
    expect(() => repositoryFromFullName("acme")).toThrow();
    expect(() => repositoryFromFullName("acme/app/extra")).toThrow();
  });
});

describe("readRepositoryContext", () => {
  it("repository-local reviewtrace.workspace를 optional hint로 읽는다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewtrace-git-"));
    try {
      await run("git", ["init", directory]);
      await run("git", ["-C", directory, "remote", "add", "origin", "git@github.com:acme/app.git"]);
      await run("git", ["-C", directory, "config", "--local", "reviewtrace.workspace", "workspace-a"]);

      await expect(readRepositoryContext(directory)).resolves.toMatchObject({
        fullName: "acme/app",
        workspaceSlug: "workspace-a",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/**
 * 🔴 되돌림 확인(2026-08-28): `parseRemote` 의 `.toLowerCase()` 를 떼면
 * 「SCP 형태의 대문자 host 도 받는다」가 실패한다. 직접 확인했다.
 *
 * DNS 는 대소문자를 가리지 않으므로 `git@GitHub.com:acme/app` 은 정상적인 origin 이다.
 * URL 형태는 `new URL()` 이 소문자로 만들어 주지만 SCP 형태는 정규식이 그대로 잡는다 —
 * 맞추지 않으면 멀쩡한 저장소가 거절된다.
 */
describe("parseRemote — host 대소문자", () => {
  it("🔴 SCP 형태의 대문자 host 도 받는다", () => {
    expect(parseRemote("git@GitHub.com:acme/app.git")).toMatchObject({
      owner: "acme",
      name: "app",
    });
  });

  it("URL 형태의 대문자 host 도 받는다", () => {
    expect(parseRemote("https://GITHUB.COM/acme/app")).toMatchObject({
      owner: "acme",
      name: "app",
    });
  });

  it("대문자로 적어도 남의 호스트는 여전히 거절한다", () => {
    expect(parseRemote("git@NotGitHub.com:acme/app.git")).toBeNull();
    expect(parseRemote("git@GHE.github.com:acme/app.git")).toBeNull();
  });
});
