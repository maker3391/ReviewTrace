import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it.each(["develop", "feature/source-context"])(
    "captures current branch %s and immutable HEAD instead of defaultBranch",
    async (branch) => {
      const directory = await createRepository();
      try {
        await run("git", ["-C", directory, "switch", "-c", branch]);
        const expectedHead = (
          await run("git", ["-C", directory, "rev-parse", "HEAD"])
        ).stdout.trim();

        await expect(readRepositoryContext(directory)).resolves.toMatchObject({
          defaultBranch: "main",
          branch,
          commitSha: expectedHead,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("supports detached HEAD with a commit SHA and no invented branch", async () => {
    const directory = await createRepository();
    try {
      const expectedHead = (
        await run("git", ["-C", directory, "rev-parse", "HEAD"])
      ).stdout.trim();
      await run("git", ["-C", directory, "checkout", "--detach", expectedHead]);

      await expect(readRepositoryContext(directory)).resolves.toMatchObject({
        branch: null,
        commitSha: expectedHead,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps HEAD as source identity when the working tree has uncommitted changes", async () => {
    const directory = await createRepository();
    try {
      const expectedHead = (
        await run("git", ["-C", directory, "rev-parse", "HEAD"])
      ).stdout.trim();
      await writeFile(join(directory, "source.txt"), "local uncommitted AFTER\n", "utf8");

      const context = await readRepositoryContext(directory);
      expect(context.commitSha).toBe(expectedHead);
      expect(context.branch).toBe("main");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("a later branch move does not mutate the commit captured for an earlier Review", async () => {
    const directory = await createRepository();
    try {
      const reviewContext = await readRepositoryContext(directory);
      await run("git", [
        "-C",
        directory,
        "-c",
        "user.name=ReviewTrace",
        "-c",
        "user.email=reviewtrace@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "next",
      ]);
      const movedContext = await readRepositoryContext(directory);

      expect(movedContext.commitSha).not.toBe(reviewContext.commitSha);
      expect(reviewContext.commitSha).toMatch(/^[0-9a-f]{40}$/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function createRepository() {
  const directory = await mkdtemp(join(tmpdir(), "reviewtrace-source-"));
  await run("git", ["init", "--initial-branch=main", directory]);
  await run("git", [
    "-C",
    directory,
    "remote",
    "add",
    "origin",
    "git@github.com:acme/app.git",
  ]);
  await writeFile(join(directory, "source.txt"), "committed BEFORE\n", "utf8");
  await run("git", ["-C", directory, "add", "source.txt"]);
  await run("git", [
    "-C",
    directory,
    "-c",
    "user.name=ReviewTrace",
    "-c",
    "user.email=reviewtrace@example.test",
    "commit",
    "-m",
    "initial",
  ]);
  await run("git", [
    "-C",
    directory,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);
  return directory;
}

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
