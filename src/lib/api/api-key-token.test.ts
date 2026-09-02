import { describe, expect, it } from "vitest";

import {
  AGENT_CREDENTIAL_PREFIX,
  apiKeyHashEquals,
  generateAgentCredential,
  hashApiKey,
  isApiKeyFormat,
  readBearerToken,
} from "@/lib/api/api-key-token";

/**
 * 이 시험이 지키는 것은 **「원문이 남지 않는다」** 하나다.
 *
 * 되돌림 확인(2026-08-28): `generateAgentCredential` 이 `keyHash` 자리에 `plainToken` 을
 * 담게 되돌리면 「Hash 는 원문을 담지 않는다」가 실패한다. 직접 확인했다.
 *
 * 🔴 **자격은 한 가지뿐이다.** 예전의 Workspace API Key(`ci_` + 43자)는 발급도 인증도
 * 걷어냈다 — 그래서 그 모양은 아래에서 **형식 자체로 거절되는 것**이 옳다.
 */
describe("generateAgentCredential", () => {
  it("ci_agent_ 로 시작하는 원문과 Prefix·Hash 를 만든다", () => {
    const key = generateAgentCredential();

    expect(key.plainToken.startsWith(AGENT_CREDENTIAL_PREFIX)).toBe(true);
    expect(key.keyPrefix).toBe(
      key.plainToken.slice(0, AGENT_CREDENTIAL_PREFIX.length + 8),
    );
    expect(isApiKeyFormat(key.plainToken)).toBe(true);
  });

  it("Hash 는 원문을 담지 않는다", () => {
    const key = generateAgentCredential();

    expect(key.keyHash).not.toContain(key.plainToken);
    // 앞 8자(Prefix)만으로 원문을 복원할 수 없다 — 나머지 35자가 Hash 에도 남지 않는다.
    expect(key.keyHash).not.toContain(
      key.plainToken.slice(AGENT_CREDENTIAL_PREFIX.length),
    );
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("호출마다 다른 토큰을 만든다", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateAgentCredential().plainToken),
    );

    expect(tokens.size).toBe(50);
  });

  it("같은 원문은 같은 Hash 가 된다 — 조회가 성립한다", () => {
    const key = generateAgentCredential();

    expect(hashApiKey(key.plainToken)).toBe(key.keyHash);
  });
});

describe("isApiKeyFormat", () => {
  it("접두사가 없으면 거절한다", () => {
    const key = generateAgentCredential();

    expect(
      isApiKeyFormat(key.plainToken.slice(AGENT_CREDENTIAL_PREFIX.length)),
    ).toBe(false);
  });

  /**
   * 🔴 **되돌림 확인용 시험이다.** `isApiKeyFormat` 에 예전의 `ci_` 갈래를 되살리면
   * 이 시험이 실패한다 — 걷어낸 인증 경로가 형식 검사만으로 되살아나지 않게 잡는다.
   */
  it("🔴 예전의 ci_ Workspace Key 모양을 거절한다", () => {
    expect(isApiKeyFormat(`ci_${"a".repeat(43)}`)).toBe(false);
    expect(readBearerToken(`Bearer ci_${"a".repeat(43)}`)).toBeNull();
  });

  it("길이가 다르면 거절한다", () => {
    expect(isApiKeyFormat(`${AGENT_CREDENTIAL_PREFIX}short`)).toBe(false);
    expect(isApiKeyFormat(`${AGENT_CREDENTIAL_PREFIX}${"a".repeat(44)}`)).toBe(
      false,
    );
  });

  it("base64url 밖의 글자를 거절한다", () => {
    expect(isApiKeyFormat(`${AGENT_CREDENTIAL_PREFIX}${"a".repeat(42)}+`)).toBe(
      false,
    );
    expect(isApiKeyFormat(`${AGENT_CREDENTIAL_PREFIX}${"a".repeat(42)}/`)).toBe(
      false,
    );
  });
});

describe("readBearerToken", () => {
  it("Bearer 토큰을 꺼낸다", () => {
    const key = generateAgentCredential();

    expect(readBearerToken(`Bearer ${key.plainToken}`)).toBe(key.plainToken);
  });

  it("헤더가 없거나 형식이 아니면 null 이다", () => {
    const key = generateAgentCredential();

    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken("")).toBeNull();
    expect(readBearerToken(key.plainToken)).toBeNull();
    expect(readBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(readBearerToken("Bearer not-a-key")).toBeNull();
  });
});

describe("keyPrefix · apiKeyHashEquals", () => {
  it("Prefix 는 원문보다 짧다", () => {
    const key = generateAgentCredential();

    expect(key.keyPrefix.length).toBeLessThan(key.plainToken.length);
  });

  it("길이가 다른 Hash 를 비교해도 던지지 않는다", () => {
    expect(apiKeyHashEquals("a", "bb")).toBe(false);
    expect(apiKeyHashEquals("abc", "abc")).toBe(true);
  });
});
