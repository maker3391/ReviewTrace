import { describe, expect, it } from "vitest";

import {
  API_KEY_PREFIX,
  apiKeyHashEquals,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
  keyPrefixOf,
  readBearerToken,
} from "@/lib/api/api-key-token";

/**
 * 이 시험이 지키는 것은 **「원문이 남지 않는다」** 하나다.
 *
 * 되돌림 확인(2026-08-28): `generateApiKey` 가 `keyHash` 자리에 `plainToken` 을 담게
 * 되돌리면 「Hash 는 원문을 담지 않는다」가 실패한다. 직접 확인했다.
 */
describe("generateApiKey", () => {
  it("ci_ 로 시작하는 원문과 Prefix·Hash 를 만든다", () => {
    const key = generateApiKey();

    expect(key.plainToken.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.keyPrefix).toBe(key.plainToken.slice(0, API_KEY_PREFIX.length + 8));
    expect(isApiKeyFormat(key.plainToken)).toBe(true);
  });

  it("Hash 는 원문을 담지 않는다", () => {
    const key = generateApiKey();

    expect(key.keyHash).not.toContain(key.plainToken);
    // 앞 8자(Prefix)만으로 원문을 복원할 수 없다 — 나머지 35자가 Hash 에도 남지 않는다.
    expect(key.keyHash).not.toContain(key.plainToken.slice(API_KEY_PREFIX.length));
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("호출마다 다른 토큰을 만든다", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateApiKey().plainToken),
    );

    expect(tokens.size).toBe(50);
  });

  it("같은 원문은 같은 Hash 가 된다 — 조회가 성립한다", () => {
    const key = generateApiKey();

    expect(hashApiKey(key.plainToken)).toBe(key.keyHash);
  });
});

describe("isApiKeyFormat", () => {
  it("접두사가 없으면 거절한다", () => {
    const key = generateApiKey();

    expect(isApiKeyFormat(key.plainToken.slice(API_KEY_PREFIX.length))).toBe(false);
  });

  it("길이가 다르면 거절한다", () => {
    expect(isApiKeyFormat(`${API_KEY_PREFIX}short`)).toBe(false);
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(44)}`)).toBe(false);
  });

  it("base64url 밖의 글자를 거절한다", () => {
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(42)}+`)).toBe(false);
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(42)}/`)).toBe(false);
  });
});

describe("readBearerToken", () => {
  it("Bearer 토큰을 꺼낸다", () => {
    const key = generateApiKey();

    expect(readBearerToken(`Bearer ${key.plainToken}`)).toBe(key.plainToken);
  });

  it("헤더가 없거나 형식이 아니면 null 이다", () => {
    const key = generateApiKey();

    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken("")).toBeNull();
    expect(readBearerToken(key.plainToken)).toBeNull();
    expect(readBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(readBearerToken("Bearer not-a-key")).toBeNull();
  });
});

describe("keyPrefixOf · apiKeyHashEquals", () => {
  it("Prefix 는 원문보다 짧다", () => {
    const key = generateApiKey();

    expect(keyPrefixOf(key.plainToken).length).toBeLessThan(key.plainToken.length);
  });

  it("길이가 다른 Hash 를 비교해도 던지지 않는다", () => {
    expect(apiKeyHashEquals("a", "bb")).toBe(false);
    expect(apiKeyHashEquals("abc", "abc")).toBe(true);
  });
});
