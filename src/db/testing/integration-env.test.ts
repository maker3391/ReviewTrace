import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadIntegrationDbEnv } from "@/db/testing/integration-env";

/**
 * 「`.env` 가 없다」와 「DB integration 이 실패했다」는 다른 일이다.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 통합시험 bootstrap 이 `process.loadEnvFile(".env")` 를 그냥 불러서, 파일이 없으면
 * **`DATABASE_URL` 이 이미 주입돼 있어도** `ENOENT` 로 통째로 터졌다. CI 에서 그것은
 * 「제품 코드가 깨졌다」와 구분되지 않는 빨간불이다.
 *
 * ## 여기서 보지 «않는» 것
 *
 * 접속이 실제로 되는가 · Migration 이 맞는가 — 그것은 통합시험 본체가 볼 몫이다.
 * 여기서는 **설정을 어디서 얻고, 무엇을 실패로 치는가**만 본다.
 */

const originalCwd = process.cwd();
const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalUrl;
  }
});

/** `.env` 가 없는 빈 디렉터리로 옮겨 간다. */
function inDirectoryWithoutEnvFile(): void {
  process.chdir(mkdtempSync(join(tmpdir(), "ci-no-env-")));
}

/** `.env` 가 있는 디렉터리로 옮겨 간다. */
function inDirectoryWithEnvFile(url: string): void {
  const directory = mkdtempSync(join(tmpdir(), "ci-env-"));
  writeFileSync(join(directory, ".env"), `DATABASE_URL=${url}\n`, "utf8");
  process.chdir(directory);
}

describe("loadIntegrationDbEnv", () => {
  it(".env 가 있으면 거기서 읽는다", () => {
    delete process.env.DATABASE_URL;
    inDirectoryWithEnvFile("postgres://from-file/db");

    loadIntegrationDbEnv();

    expect(process.env.DATABASE_URL).toBe("postgres://from-file/db");
  });

  /**
   * 🔴 **이 파일의 핵심.** `.env` 는 local 편의일 뿐 필수 의존이 아니다.
   * CI 처럼 환경 변수가 이미 주입된 자리는 파일 없이도 돌아야 한다.
   */
  it("🔴 .env 가 없어도 환경 변수로 충분하면 돈다", () => {
    process.env.DATABASE_URL = "postgres://injected/db";
    inDirectoryWithoutEnvFile();

    expect(() => loadIntegrationDbEnv()).not.toThrow();
    expect(process.env.DATABASE_URL).toBe("postgres://injected/db");
  });

  /** 주입된 값이 정본이다 — local 파일이 CI 가 정한 값을 덮지 않는다. */
  it("이미 주입된 값을 .env 로 덮어쓰지 않는다", () => {
    process.env.DATABASE_URL = "postgres://injected/db";
    inDirectoryWithEnvFile("postgres://from-file/db");

    loadIntegrationDbEnv();

    expect(process.env.DATABASE_URL).toBe("postgres://injected/db");
  });

  /** 🔴 조용히 건너뛰지 않는다 — 확인한 것이 없는데 초록인 시험을 만들지 않는다. */
  it("🔴 어디에도 DATABASE_URL 이 없으면 «설정 오류»로 실패한다", () => {
    delete process.env.DATABASE_URL;
    inDirectoryWithoutEnvFile();

    expect(() => loadIntegrationDbEnv()).toThrow(/DATABASE_URL/);
  });

  /**
   * 🔴 **삼키는 것은 「파일 없음」 하나뿐이다.** 권한 오류처럼 다른 실패까지 덮으면
   * 「초록인데 아무것도 확인하지 않은」 시험이 된다.
   */
  it("🔴 파일 없음이 «아닌» 오류는 그대로 올라간다", () => {
    delete process.env.DATABASE_URL;
    inDirectoryWithoutEnvFile();

    const original = process.loadEnvFile;
    process.loadEnvFile = () => {
      throw Object.assign(new Error("권한 없음"), { code: "EACCES" });
    };

    try {
      expect(() => loadIntegrationDbEnv()).toThrow("권한 없음");
    } finally {
      process.loadEnvFile = original;
    }
  });
});
