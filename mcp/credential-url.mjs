/** Credential 을 붙여도 되는 API base URL 규칙. 문자열 prefix 가 아니라 URL 구성요소로 판정한다. */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class CredentialUrlError extends Error {}

/** HTTPS 가 정본이고, 명시적인 loopback HTTP 만 local development 예외다. */
export function normalizeCredentialApiUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CredentialUrlError(
      "ReviewTrace API URL 이 절대 URL 형식이 아니다.",
    );
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new CredentialUrlError(
      "ReviewTrace API URL 에 credential, query, fragment 를 넣을 수 없다.",
    );
  }

  const secure = url.protocol === "https:";
  const localHttp =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (!secure && !localHttp) {
    throw new CredentialUrlError(
      "ReviewTrace API URL 은 HTTPS 여야 한다. 로컬 개발은 localhost, 127.0.0.1, ::1 의 HTTP 만 허용한다.",
    );
  }

  if (url.pathname !== "/") {
    throw new CredentialUrlError(
      "ReviewTrace API URL 은 path 없는 origin 이어야 한다.",
    );
  }

  return url.origin;
}

/** Authorization header 를 만들기 직전에도 request가 검증된 base origin을 벗어나지 않았는지 본다. */
export function assertCredentialRequestUrl(requestUrl, baseUrl) {
  const request = new URL(requestUrl);
  const base = new URL(normalizeCredentialApiUrl(baseUrl));
  if (request.origin !== base.origin) {
    throw new CredentialUrlError(
      "ReviewTrace credential 을 설정된 API origin 밖으로 보낼 수 없다.",
    );
  }
}
