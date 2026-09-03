import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  classifyEvidenceSource,
  parseRemote,
  readChangedFiles,
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

/**
 * 🔴 **이 묶음만 실제 git 프로세스를 수십 개 띄운다.**
 *
 * 시험 하나가 임시 저장소를 만들고(`init`·`remote add`·`add`·`commit`) 그 위에서
 * `readRepositoryContext` 를 부르는데, 그것만으로도 git 을 다섯 번 부른다. Windows 에서
 * 프로세스 생성이 느린 데다 vitest 가 다른 파일과 «병렬»로 돌려서, 기본 5 초 상한에
 * 걸려 실제로 간헐적으로 빨개졌다(세 번 돌려 1·3·2 건 실패를 재현했다).
 *
 * 🔴 **assertion 을 약하게 만들어 넘긴 것이 아니다** — 검사 내용은 그대로이고, 이 파일이
 * 실제로 하는 일(subprocess I/O)에 맞는 시간을 준 것뿐이다. 제품 코드의 git 호출에는
 * 여전히 `TIMEOUT_MS`(5 초)가 따로 걸려 있어, 멈춘 git 이 Tool 을 붙잡지는 않는다.
 */
describe("readRepositoryContext", { timeout: 30_000 }, () => {
  it("repository-local reviewtrace.workspace를 optional hint로 읽는다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewtrace-git-"));
    try {
      await run("git", ["init", directory]);
      await run("git", [
        "-C",
        directory,
        "remote",
        "add",
        "origin",
        "git@github.com:acme/app.git",
      ]);
      await run("git", [
        "-C",
        directory,
        "config",
        "--local",
        "reviewtrace.workspace",
        "workspace-a",
      ]);

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
      await writeFile(
        join(directory, "source.txt"),
        "local uncommitted AFTER\n",
        "utf8",
      );
      await writeFile(join(directory, "untracked.txt"), "new file\n", "utf8");

      const context = await readRepositoryContext(directory);
      expect(context.commitSha).toBe(expectedHead);
      expect(context.branch).toBe("main");
      expect(context.changedFiles).toEqual(["source.txt", "untracked.txt"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /**
   * 지운 파일과 이름을 바꾼 파일도 「이번에 손댄 경로」다.
   *
   * 🔴 rename 은 git 이 **새 이름만** 준다 — 옛 이름으로 남은 과거 Issue 는 SAME_FILE 로
   * 걸리지 않고 같은 directory 로만 이어진다. 이름 대조에 기댄 relevance 의 한계다.
   */
  it("includes deleted and renamed paths without sending any diff content", async () => {
    const directory = await createRepository();
    try {
      await writeFile(join(directory, "doomed.txt"), "gone soon\n", "utf8");
      await commitAll(directory, "second");

      await run("git", ["-C", directory, "rm", "-q", "doomed.txt"]);
      await run("git", ["-C", directory, "mv", "source.txt", "renamed.txt"]);

      const context = await readRepositoryContext(directory);

      expect(context.changedFiles).toEqual(["doomed.txt", "renamed.txt"]);
      // 경로만 나간다 — 파일 내용이 섞여 나가면 Review payload 가 소스 사본이 된다.
      expect(JSON.stringify(context.changedFiles)).not.toContain("gone soon");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 merge commit 에서는 `git diff-tree` 가 아무것도 내지 않는다(직접 확인).
   * 깨끗한 tree 위의 merge 는 changedFiles 가 비고, relevance 는 file 신호 없이
   * severity·recurrence 로만 정렬된다 — 실패가 아니라 알려진 한계다.
   */
  it("returns no changed files for a merge commit on a clean tree", async () => {
    const directory = await createRepository();
    try {
      await run("git", ["-C", directory, "checkout", "-q", "-b", "side"]);
      await writeFile(join(directory, "side.txt"), "side\n", "utf8");
      await commitAll(directory, "side");
      await run("git", ["-C", directory, "checkout", "-q", "main"]);
      await writeFile(join(directory, "main.txt"), "main\n", "utf8");
      await commitAll(directory, "main");
      await run("git", [
        "-C",
        directory,
        "-c",
        "user.name=ReviewTrace",
        "-c",
        "user.email=reviewtrace@example.test",
        "merge",
        "-q",
        "--no-ff",
        "side",
        "-m",
        "merge",
      ]);

      const context = await readRepositoryContext(directory);

      expect(context.changedFiles).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the immutable HEAD file list when the working tree is clean", async () => {
    const directory = await createRepository();
    try {
      const context = await readRepositoryContext(directory);

      expect(context.changedFiles).toEqual(["source.txt"]);
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

async function commitAll(directory, message) {
  await run("git", ["-C", directory, "add", "-A"]);
  await run("git", [
    "-C",
    directory,
    "-c",
    "user.name=ReviewTrace",
    "-c",
    "user.email=reviewtrace@example.test",
    "commit",
    "-m",
    message,
  ]);
}

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

/**
 * 🔴 **읽기 실패를 「바뀐 파일 없음」으로 위장하지 않는다**
 * (`SILENT_FALLBACK_HIDES_READ_FAILURE`).
 *
 * 예전 `gitPaths` 는 `maxBuffer: 1_000_000` 을 걸어 두고 실패를 `catch { return []; }`
 * 로 받았다. 출력이 그 크기를 넘으면 Node 가 자식을 죽이고
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 를 던지는데, 그 오류가 「정말 바뀐 파일이 없다」와
 * **같은 값으로 접혔다.** 그리고 `working.length > 0` 이 거짓이 되어 HEAD commit 경로로
 * 내려가, 직전 commit 의 파일 목록이 working tree 인 것처럼 나갔다.
 *
 * 아래 시험은 `maxBytes` 를 낮춰 **실제 `maxBuffer` 초과**를 일으킨다.
 */
describe("readChangedFiles — 못 읽은 것과 없는 것", () => {
  it("바뀐 파일이 정말 없으면 available 이 true 다", async () => {
    const directory = await createRepository();
    try {
      const changed = await readChangedFiles(directory);

      expect(changed.available).toBe(true);
      // 깨끗한 working tree 라 HEAD commit 이 바꾼 경로가 나온다.
      expect(changed.paths).toContain("source.txt");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("working tree 를 읽다 끊기면 available 이 false 이고 목록이 비어 있다", async () => {
    const directory = await createRepository();
    try {
      for (let index = 0; index < 200; index += 1) {
        await writeFile(join(directory, `untracked-${index}.txt`), "x", "utf8");
      }

      const changed = await readChangedFiles(directory, { maxBytes: 64 });

      expect(changed.available).toBe(false);
      expect(changed.paths).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("🔴 읽다 끊긴 실행이 HEAD commit 의 파일로 메워지지 않는다", async () => {
    const directory = await createRepository();
    try {
      for (let index = 0; index < 200; index += 1) {
        await writeFile(join(directory, `untracked-${index}.txt`), "x", "utf8");
      }

      const changed = await readChangedFiles(directory, { maxBytes: 64 });

      // 예전 구현은 여기서 초기 commit 의 `source.txt` 를 working tree 로 둔갑시켰다.
      expect(changed.paths).not.toContain("source.txt");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("commit 이 하나도 없는 저장소는 «대답» 이므로 available 이 true 다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewtrace-unborn-"));
    try {
      await run("git", ["init", "--initial-branch=main", directory]);
      await writeFile(join(directory, "draft.txt"), "x", "utf8");

      // `git diff HEAD` 는 128 로 끝나지만 그것은 git 이 낸 대답이다 — 끊긴 읽기가 아니다.
      const changed = await readChangedFiles(directory);

      expect(changed.available).toBe(true);
      expect(changed.paths).toContain("draft.txt");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/**
 * `changedFiles` 가 비어 있는 것을 「바뀐 파일이 없다」로 읽어도 되는지를
 * Repository Context 가 함께 말한다.
 */
describe("readRepositoryContext — changedFilesAvailable", () => {
  it("정상적으로 읽었으면 true 다", async () => {
    const directory = await createRepository();
    try {
      const context = await readRepositoryContext(directory);

      expect(context.changedFilesAvailable).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("일부러 묻지 않았으면 false 다 — 빈 목록이 사실이 아니다", async () => {
    const directory = await createRepository();
    try {
      const context = await readRepositoryContext(directory, {
        includeChangedFiles: false,
      });

      expect(context.changedFiles).toEqual([]);
      expect(context.changedFilesAvailable).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("이름만으로 가리킨 다른 저장소도 false 다", () => {
    expect(repositoryFromFullName("acme/app").changedFilesAvailable).toBe(
      false,
    );
  });
});

/**
 * 🔴 이 시험이 지키는 것은 **「아직 커밋하지 않은 코드를 그 commit 에 있다고 말하지 않는다」**와
 * 그 반대인 **「진짜 불일치를 커밋 전이라고 덮지 않는다」** 둘 다이다.
 *
 * 이 결함은 실제로 있었다 — 개발은 늘 고친 «뒤에» 커밋하므로 AFTER 근거의 `commitSha` 에는
 * HEAD 가 들어갔고, 그 commit 에는 그 코드가 없어 서버 대조가 **구조적으로 `MISMATCH`** 로
 * 남았다. 「수정이 실패했다」는 뜻이 아닌데도 화면은 그렇게 읽혔다.
 */
describe("classifyEvidenceSource", { timeout: 30_000 }, () => {
  it("커밋된 코드는 COMMITTED 다", async () => {
    const directory = await createRepository();
    try {
      const head = (
        await run("git", ["-C", directory, "rev-parse", "HEAD"])
      ).stdout.trim();

      await expect(
        classifyEvidenceSource(directory, {
          commitSha: head,
          filePath: "source.txt",
          startLine: 1,
          endLine: 1,
          snapshot: "committed BEFORE",
        }),
      ).resolves.toBe("COMMITTED");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("🔴 아직 커밋하지 않은 수정은 WORKING_TREE 다 — HEAD 를 적었어도", async () => {
    const directory = await createRepository();
    try {
      const head = (
        await run("git", ["-C", directory, "rev-parse", "HEAD"])
      ).stdout.trim();
      // 고쳤지만 아직 커밋하지 않았다. Agent 가 적을 수 있는 SHA 는 여전히 HEAD 다.
      await writeFile(
        join(directory, "source.txt"),
        "fixed AFTER, not committed\n",
        "utf8",
      );

      await expect(
        classifyEvidenceSource(directory, {
          commitSha: head,
          filePath: "source.txt",
          startLine: 1,
          endLine: 1,
          snapshot: "fixed AFTER, not committed",
        }),
      ).resolves.toBe("WORKING_TREE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **새 파일을 만들며 고치는 것은 흔한 작업이다.**
   *
   * 그 파일은 바탕 commit 에 «없다». 예전에는 `git show <sha>:<path>` 가 실패한 것을
   * 「commit 을 읽지 못했다」와 같이 다뤄 index·디스크를 보지도 않고 돌아갔다 —
   * `sourceState` 가 붙지 않아 서버 기본값 `COMMITTED` 로 저장되고, GitHub 대조가
   * 그 경로를 찾지 못해 화면이 「아직 커밋 전」 대신 「확인할 수 없음」을 그렸다.
   */
  it("🔴 그 commit 에 «없던» 새 파일도 WORKING_TREE 다", async () => {
    const directory = await createRepository();
    try {
      const head = (
        await run("git", ["-C", directory, "rev-parse", "HEAD"])
      ).stdout.trim();
      // 바탕 commit 에는 존재하지 않는 파일이다. Agent 가 적을 SHA 는 여전히 HEAD 다.
      await writeFile(
        join(directory, "created.txt"),
        "brand new line\n",
        "utf8",
      );

      await expect(
        classifyEvidenceSource(directory, {
          commitSha: head,
          filePath: "created.txt",
          startLine: 1,
          endLine: 1,
          snapshot: "brand new line",
        }),
      ).resolves.toBe("WORKING_TREE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **「유효한 commit 인가」로는 부족하다 — 「지금의 바탕인가」를 물어야 한다.**
   *
   * `rev-parse` 는 full SHA 뿐 아니라 short SHA · tag · branch · `HEAD~n` 을 전부 받는다.
   * 그래서 「commit 으로 풀리는가」만 보면 **오래된 ref 를 준 것만으로 이미 커밋된 파일이
   * `WORKING_TREE` 로 분류되어** 서버의 원본 대조를 통째로 건너뛴다. reviewer 가 다섯
   * 형태를 모두 재현했다.
   */
  it("🔴 오래된 ref 로는 이미 커밋된 파일을 커밋 전으로 만들지 못한다", async () => {
    const directory = await createRepository();
    try {
      const commit = async (message) =>
        run("git", [
          "-C", directory,
          "-c", "user.name=ReviewTrace",
          "-c", "user.email=reviewtrace@example.test",
          "commit", "-m", message,
        ]);

      // 첫 commit 에는 없던 파일을 «커밋한다». 작업 tree 는 깨끗하다.
      const before = (await run("git", ["-C", directory, "rev-parse", "HEAD"])).stdout.trim();
      await run("git", ["-C", directory, "tag", "v-old"]);
      await writeFile(join(directory, "added.txt"), "committed later\n", "utf8");
      await run("git", ["-C", directory, "add", "added.txt"]);
      await commit("add file");

      const evidence = {
        filePath: "added.txt",
        startLine: 1,
        endLine: 1,
        snapshot: "committed later",
      };

      // 그 파일이 «없던» 시절을 가리키는 값들 — 전부 판정하지 않는다.
      for (const stale of [before, before.slice(0, 7), "HEAD~1", "v-old"]) {
        await expect(
          classifyEvidenceSource(directory, { ...evidence, commitSha: stale }),
          stale,
        ).resolves.toBeNull();
      }

      // 🔴 지금의 바탕(HEAD)을 «어떤 철자로 적든» 커밋된 것은 COMMITTED 다.
      const head = (await run("git", ["-C", directory, "rev-parse", "HEAD"])).stdout.trim();
      for (const now of [head, head.slice(0, 7), "HEAD"]) {
        await expect(
          classifyEvidenceSource(directory, { ...evidence, commitSha: now }),
          now,
        ).resolves.toBe("COMMITTED");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **commit 을 읽지 못한 것까지 「커밋 전」으로 밀면 보증이 사라진다.**
   *
   * 다른 저장소의 SHA 를 적어 보내면 그 근거는 이 저장소가 판정할 대상이 아니다.
   */
  it("🔴 이 저장소의 commit 이 아니면 파일이 있어도 판정하지 않는다", async () => {
    const directory = await createRepository();
    try {
      await writeFile(
        join(directory, "created.txt"),
        "brand new line\n",
        "utf8",
      );

      await expect(
        classifyEvidenceSource(directory, {
          // 형식은 SHA 인데 이 저장소에 없는 commit 이다.
          commitSha: "0".repeat(40),
          filePath: "created.txt",
          startLine: 1,
          endLine: 1,
          snapshot: "brand new line",
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /** 🔴 이것이 「검증 면제 스위치」가 되지 않게 막는 자리다. */
  it("🔴 그 commit 에도 working tree 에도 없는 코드는 판정하지 않는다", async () => {
    const directory = await createRepository();
    try {
      const head = (
        await run("git", ["-C", directory, "rev-parse", "HEAD"])
      ).stdout.trim();

      await expect(
        classifyEvidenceSource(directory, {
          commitSha: head,
          filePath: "source.txt",
          startLine: 1,
          endLine: 1,
          snapshot: "이 저장소에 존재한 적 없는 코드",
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **줄 범위를 보냈으면 «그 줄»이 근거다.**
   *
   * 조각이 파일 어딘가에 있다는 사실만으로 `COMMITTED` 를 붙이면, 서버는 그 줄만 읽어
   * 대조하므로 같은 근거가 `MISMATCH` 로 남는다 — 화면은 그것을 「Agent 가 없는 코드를
   * 적었다」로 그린다. client 가 보증한 것을 server 가 뒤집는 구조를 만들지 않는다.
   */
  it("🔴 조각이 지정한 줄이 아닌 다른 줄에 있으면 COMMITTED 로 판정하지 않는다", async () => {
    const directory = await createRepository();
    try {
      await writeFile(
        join(directory, "source.txt"),
        'import { thing } from "./thing";\nconst unrelated = 1;\nconst target = compute();\n',
        "utf8",
      );
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
        "multiline",
      ]);
      const head = (
        await run("git", ["-C", directory, "rev-parse", "HEAD"])
      ).stdout.trim();

      // 조각은 3행에 있는데 1행이라고 적었다. 서버는 1행만 읽어 대조한다.
      await expect(
        classifyEvidenceSource(directory, {
          commitSha: head,
          filePath: "source.txt",
          startLine: 1,
          endLine: 1,
          snapshot: "const target = compute();",
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("로컬에 없는 commit 은 판정하지 않는다 — 다른 저장소의 근거를 건드리지 않는다", async () => {
    const directory = await createRepository();
    try {
      await expect(
        classifyEvidenceSource(directory, {
          commitSha: "0000000000000000000000000000000000000000",
          filePath: "source.txt",
          startLine: 1,
          endLine: 1,
          snapshot: "committed BEFORE",
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("보낸 코드가 없으면 판정하지 않는다", async () => {
    const directory = await createRepository();
    try {
      await expect(
        classifyEvidenceSource(directory, {
          commitSha: "HEAD",
          filePath: "source.txt",
          snapshot: "   ",
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
