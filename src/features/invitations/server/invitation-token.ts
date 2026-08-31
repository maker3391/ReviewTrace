import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 초대 Token.
 *
 * 🔴 **원문을 Database 에 저장하지 않는다**(스펙 7·10). 발급할 때 한 번 링크로 보여 주고
 * Hash 만 남긴다 — Database 를 읽을 수 있는 사람이 그것으로 남의 Workspace 에 들어갈 수 없다.
 *
 * 🔴 **Token 을 로그에 남기지 않는다.** 예외 message 에도 넣지 않는다.
 */

/**
 * 256bit.
 *
 * 비밀번호와 달리 사람이 고르지 않는 완전 난수라 **느린 Hash(bcrypt 등)가 필요 없다.**
 * 추측이 불가능하므로 Rainbow Table 도 무의미하다 — SHA-256 한 번이면 충분하고,
 * 그래야 조회를 Hash 로 곧장 할 수 있다. API Key 를 Hash 로만 저장하는 것과 같은 판단이다.
 */
const TOKEN_BYTES = 32;

export interface GeneratedInvitationToken {
 /** 사용자에게 링크로 한 번만 보여 주는 값. */
 token: string;
 /** Database 에 저장하는 값. */
 tokenHash: string;
}

export function generateInvitationToken(): GeneratedInvitationToken {
 // base64url 이라 주소에 그대로 넣어도 인코딩되지 않는다.
 const token = randomBytes(TOKEN_BYTES).toString("base64url");
 return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
 return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Hash 두 개를 시간 차이 없이 비교한다.
 *
 * 조회는 unique index 로 하므로 대부분 이 함수를 거치지 않지만, 값을 직접 맞대는 자리에서는
 * 앞에서부터 한 글자씩 끊는 비교가 응답 시간으로 정답을 흘린다.
 */
export function invitationTokenHashEquals(left: string, right: string): boolean {
 const leftBuffer = Buffer.from(left, "utf8");
 const rightBuffer = Buffer.from(right, "utf8");

 if (leftBuffer.length !== rightBuffer.length) {
 return false;
 }

 return timingSafeEqual(leftBuffer, rightBuffer);
}
