import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Agent API Key 의 토큰 규칙.
 *
 * ```
 * Plain Token 생성 -> Prefix 추출 -> Hash -> Hash 만 DB 저장 -> Plain Token 1회 표시
 * ```
 *
 * 🔴 **원문을 Database 에 저장하지 않는다**(스펙 20).
 * 🔴 **원문·Hash 를 Log·응답·오류 메시지에 담지 않는다.** 목록에도 나가지 않는다.
 *
 * 이 파일은 순수 함수만 둔다 — Database 를 모르므로 테스트가 그대로 쓴다.
 */

/**
 * 사람이 보고 「이건 ReviewTrace 자격이다」를 알 수 있게 하는 표시.
 *
 * 🔴 **제품명이 바뀌어도 이 접두사는 그대로 둔다.** 이미 발급된 Credential 의 앞머리이고,
 * Agent 설정에 박혀 있는 값이라 바꾸면 밖에서 쓰던 것이 끊긴다.
 */
export const AGENT_CREDENTIAL_PREFIX = "ci_agent_";

/**
 * 난수 32 바이트 = 256 bit.
 *
 * 이 Entropy 가 **Hash 방식의 근거**다. 사용자가 고른 비밀번호가 아니라 생성기가 만든
 * 난수이므로 사전 공격 대상이 아니고, 그래서 bcrypt/argon2 같은 느린 해시가 필요 없다.
 * 요청마다 도는 Lookup 이라 SHA-256 한 번이 맞다 — bcrypt·argon2 를 들이려고 의존성을
 * 늘리지 않는다.
 */
const SECRET_BYTES = 32;

/** 목록에서 어느 키인지 알아보기 위한 표시용 길이. 이것만으로는 토큰을 복원할 수 없다. */
const PREFIX_SECRET_CHARS = 8;

/** base64url 은 `A-Za-z0-9_-` 만 쓴다. 32 바이트는 padding 없이 43자다. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedAgentCredential {
  /** 🔴 **딱 한 번** 사용자에게 보여 주고 버린다. 어디에도 저장하지 않는다. */
  plainToken: string;
  /** 목록 표시용. `ci_agent_` + 앞 8자. */
  keyPrefix: string;
  /** DB 에 남는 유일한 값. */
  keyHash: string;
}

export function generateAgentCredential(): GeneratedAgentCredential {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const plainToken = `${AGENT_CREDENTIAL_PREFIX}${secret}`;

  return {
    plainToken,
    keyPrefix: plainToken.slice(
      0,
      AGENT_CREDENTIAL_PREFIX.length + PREFIX_SECRET_CHARS,
    ),
    keyHash: hashApiKey(plainToken),
  };
}

export function hashApiKey(plainToken: string): string {
  return createHash("sha256").update(plainToken, "utf8").digest("hex");
}

/**
 * 형식이 맞는 토큰인가.
 *
 * 형식부터 걸러 **Database 를 보지 않고** 거절한다 — 아무 문자열이나 Hash 해서 조회하면
 * 요청마다 인덱스를 한 번씩 태우게 된다.
 */
export function isApiKeyFormat(value: string): boolean {
  return (
    value.startsWith(AGENT_CREDENTIAL_PREFIX) &&
    SECRET_PATTERN.test(value.slice(AGENT_CREDENTIAL_PREFIX.length))
  );
}

/**
 * `Authorization: Bearer ci_agent_xxx` 에서 토큰을 꺼낸다.
 *
 * 🔴 형식이 아니면 `null` 이다. **받은 값을 오류 메시지에 되돌려 담지 않는다** —
 * 그것이 곧 토큰을 로그에 남기는 길이다.
 */
export function readBearerToken(authorization: string | null): string | null {
  if (authorization === null) {
    return null;
  }

  const match = /^Bearer[ ]+(\S+)$/.exec(authorization.trim());
  const token = match?.[1];

  if (token === undefined || !isApiKeyFormat(token)) {
    return null;
  }

  return token;
}

/**
 * Hash 비교.
 *
 * Lookup 자체가 Hash 로 이뤄져 사실상 필요 없지만, 저장된 값과 계산한 값을 맞대어 보는
 * 자리는 길이가 같은 hex 두 개다 — 그럴 때 `===` 대신 이것을 쓰는 것이 기본이다.
 */
export function apiKeyHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
