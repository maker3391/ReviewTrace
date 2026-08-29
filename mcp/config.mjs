import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * ReviewTrace MCP Server 의 접속 설정(스펙 8).
 *
 * ## 🔴 Key 를 저장소 안에 두지 않는다
 *
 * 사용자의 실제 Project `.env` 에 Key 를 넣으라고 안내하지 않는다 — 그 파일은
 * 저장소 안에 있고, 언젠가 커밋된다. Key 가 사는 곳은 **저장소 밖**이다.
 *
 * | 순서 | 어디 | 왜 |
 * |---|---|---|
 * | 1 | MCP Client 설정의 `env` | Client 가 설정 파일을 갖고 있고 저장소와 무관하다 |
 * | 2 | `~/.reviewtrace/config.json` | 사람이 한 번 적어 두고 모든 Project 에서 쓴다 |
 * | 3 | OS 환경 변수 | 이미 그렇게 관리하는 사람을 막지 않는다 |
 *
 * 1 과 3 은 둘 다 `process.env` 로 도착한다 — MCP Client 가 `env` 에 적은 값이 그대로
 * 자식 프로세스의 환경이 되기 때문이다. 그래서 코드가 보는 자리는 두 곳뿐이다.
 *
 * 🔴 **Key 를 어디에도 출력하지 않는다.** stdout 은 MCP 통신 채널이라 한 줄만 섞여도
 * Client 가 끊긴다. 진단은 전부 stderr 로 가고, 거기에도 Key 는 넣지 않는다.
 */

const HOME_CONFIG = path.join(os.homedir(), ".reviewtrace", "config.json");

/** 사람이 잘못 붙여 넣은 것을 조용히 넘기지 않는다 — 발급 화면이 주는 접두다. */
const KEY_PREFIX = "ci_";

export function loadConfig() {
  const fromFile = readHomeConfig();

  const apiUrl =
    firstNonEmpty(process.env.REVIEWTRACE_API_URL, fromFile.apiUrl) ??
    "http://localhost:3000";
  const apiKey = firstNonEmpty(process.env.REVIEWTRACE_API_KEY, fromFile.apiKey);

  if (apiKey === undefined) {
    throw new ConfigError(
      "ReviewTrace API Key 가 없다. MCP Client 설정의 env 에 REVIEWTRACE_API_KEY 를 넣거나 " +
        `${HOME_CONFIG} 에 {"apiKey": "..."} 를 적어라. Workspace Settings > API Keys 에서 발급한다.`,
    );
  }

  if (!apiKey.startsWith(KEY_PREFIX)) {
    // 🔴 값을 되돌려 담지 않는다. 「접두가 다르다」까지만 말한다.
    throw new ConfigError(
      `ReviewTrace API Key 의 형식이 아니다 (${KEY_PREFIX} 로 시작해야 한다).`,
    );
  }

  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey };
}

export class ConfigError extends Error {}

function readHomeConfig() {
  try {
    const raw = fs.readFileSync(HOME_CONFIG, "utf8");
    const parsed = JSON.parse(raw);
    return {
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : undefined,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : undefined,
    };
  } catch {
    // 없는 것이 정상이다. 깨진 것도 여기서는 「없음」과 같게 다룬다 —
    // 그 다음 줄이 「Key 가 없다」로 사람이 읽을 수 있게 말해 준다.
    return {};
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}
