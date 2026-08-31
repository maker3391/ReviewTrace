/**
 * Workspace slug.
 *
 * slug 는 주소에 그대로 나간다(`/w/{slug}/issues`). 그래서 **사람이 읽을 수 있고 URL 에서
 * 인코딩되지 않는 글자**로만 만든다.
 *
 * 🔴 slug 는 **Context 표시일 뿐 권한 증명이 아니다**. 아무리 잘 만들어도
 * 주소를 손으로 바꿀 수 있으므로, 서버는 매 요청 소속을 다시 확인한다.
 *
 * 이 파일은 순수 함수만 둔다 — Database 도 `process.env` 도 보지 않는다.
 */

/** 주소에 쓰기에 너무 길지 않게. GitHub 아이디 상한(39)보다 넉넉하다. */
const MAX_SLUG_LENGTH = 40;

/** 비어 버린 slug 의 마지막 대비. 사람 이름이 전부 한글·기호일 수 있다. */
const FALLBACK_SLUG = "workspace";

/**
 * 아무 문자열이나 slug 로 다듬는다.
 *
 * 한글처럼 ASCII 가 아닌 글자는 **버린다.** 음차로 바꾸려면 사전이 필요하고, 그 사전이
 * 사람마다 다른 결과를 내면 주소가 예측 불가능해진다. 남는 것이 없으면 `FALLBACK_SLUG` 다.
 */
export function normalizeSlug(value: string): string {
 const slug = value
.normalize("NFKD")
.toLowerCase()
 // 영숫자가 아닌 것은 전부 하이픈 한 개로 접는다.
.replace(/[^a-z0-9]+/g, "-")
.replace(/^-+|-+$/g, "")
.slice(0, MAX_SLUG_LENGTH)
 // 잘라 낸 끝이 하이픈으로 끝날 수 있다.
.replace(/-+$/g, "");

 return slug === "" ? FALLBACK_SLUG : slug;
}

/**
 * slug 후보를 순서대로 만든다.
 *
 * slug 는 전역 unique 라 원하는 이름이 이미 쓰일 수 있다. 그때 `-2`, `-3` 을 붙여 다음 후보를
 * 낸다 — **실패하면 다음 후보로 다시 시도**하는 쪽이, 미리 「비어 있는지」 물어보고 넣는 것보다
 * 안전하다. 물어본 뒤 넣는 사이에 다른 요청이 끼어들 수 있다.
 */
export function slugCandidate(base: string, attempt: number): string {
 const normalized = normalizeSlug(base);

 if (attempt === 0) {
 return normalized;
 }

 const suffix = `-${attempt + 1}`;
 return `${normalized.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
}
