const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Credential-bearing HTTP API base URL을 정규화한다. URL 값 자체는 오류에 넣지 않는다. */
export function normalizeCredentialHttpBaseUrl(
  raw: string,
  options: { allowPath: boolean },
): string {
  const url = new URL(raw);

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("credential URL에 허용되지 않는 구성요소가 있다");
  }

  const secure = url.protocol === "https:";
  const localHttp =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (!secure && !localHttp) {
    throw new Error("credential URL은 HTTPS 또는 loopback HTTP여야 한다");
  }

  if (!options.allowPath && url.pathname !== "/") {
    throw new Error("credential URL은 path 없는 origin이어야 한다");
  }

  url.pathname =
    options.allowPath && url.pathname !== "/"
      ? url.pathname.replace(/\/+$/, "")
      : "/";
  return url.toString().replace(/\/$/, "");
}

/** Credential header를 붙이기 직전 request가 설정된 origin/base path 안인지 확인한다. */
export function assertCredentialRequestUrl(
  requestUrl: URL,
  baseUrl: string,
): void {
  const base = new URL(
    normalizeCredentialHttpBaseUrl(baseUrl, { allowPath: true }),
  );
  const basePath = base.pathname === "/" ? "" : base.pathname;
  const insideBasePath =
    basePath === "" ||
    requestUrl.pathname === basePath ||
    requestUrl.pathname.startsWith(`${basePath}/`);

  if (requestUrl.origin !== base.origin || !insideBasePath) {
    throw new Error("credential request가 설정된 API base URL을 벗어났다");
  }
}
