import "server-only";

import { createSign } from "node:crypto";

import { githubAppEnv } from "@/lib/env";
import { githubApiUrl } from "@/lib/github/content";
import { assertCredentialRequestUrl } from "@/lib/security/credential-url";

const API_VERSION = "2022-11-28";
const TIMEOUT_MS = 8_000;

export class GithubAppError extends Error {
  constructor(
    readonly kind:
      "CONFIGURATION" | "UNAUTHORIZED" | "NOT_FOUND" | "UNAVAILABLE",
  ) {
    super(kind);
    this.name = "GithubAppError";
  }
}

export interface GithubRepositoryMetadata {
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

export interface GithubInstallationMetadata {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** RS256, iat -60s, exp +9m: GitHub의 JWT 계약 안에서만 유효하다. */
export function createGithubAppJwt(now = new Date()): string {
  const env = githubAppEnv();
  const seconds = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: seconds - 60,
      exp: seconds + 540,
      iss: env.GITHUB_APP_ID,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "ReviewTrace",
  };
}

async function githubFetch(url: URL, init: RequestInit): Promise<Response> {
  const env = githubAppEnv();
  const apiBase = new URL(env.GITHUB_API_URL);
  const apiPath =
    apiBase.pathname === "/" ? "/" : `${apiBase.pathname.replace(/\/+$/, "")}/`;
  const isApiUrl =
    url.origin === apiBase.origin &&
    (apiPath === "/" ||
      url.pathname === apiBase.pathname ||
      url.pathname.startsWith(apiPath));
  assertCredentialRequestUrl(
    url,
    isApiUrl ? env.GITHUB_API_URL : env.GITHUB_WEB_URL,
  );
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new GithubAppError("UNAVAILABLE");
  }
}

export function githubAppInstallationUrl(state: string): string {
  const env = githubAppEnv();
  const url = new URL(
    `/apps/${env.GITHUB_APP_SLUG}/installations/new`,
    env.GITHUB_WEB_URL,
  );
  url.searchParams.set("state", state);
  return url.toString();
}

/** callback code로 받은 user token은 설치 소유권 확인 한 번에만 쓰고 반환 후 폐기한다. */
export async function exchangeGithubAppCode(code: string): Promise<string> {
  const env = githubAppEnv();
  const url = new URL("/login/oauth/access_token", env.GITHUB_WEB_URL);
  const response = await githubFetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "ReviewTrace",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
    }),
  });
  if (!response.ok) throw new GithubAppError("UNAUTHORIZED");
  const body: unknown = await response.json();
  const token =
    typeof body === "object" && body !== null
      ? (body as { access_token?: unknown }).access_token
      : undefined;
  if (typeof token !== "string" || token === "")
    throw new GithubAppError("UNAUTHORIZED");
  return token;
}

export async function userCanManageInstallation(
  userToken: string,
  installationId: string,
): Promise<boolean> {
  const env = githubAppEnv();
  for (let page = 1; page <= 10; page += 1) {
    const url = githubApiUrl(env.GITHUB_API_URL, "user/installations", {
      per_page: "100",
      page: String(page),
    });
    const response = await githubFetch(url, { headers: apiHeaders(userToken) });
    if (!response.ok) throw new GithubAppError("UNAUTHORIZED");
    const body: unknown = await response.json();
    const installations =
      typeof body === "object" &&
      body !== null &&
      Array.isArray((body as { installations?: unknown }).installations)
        ? (body as { installations: unknown[] }).installations
        : [];
    if (
      installations.some(
        (item) => String((item as { id?: unknown })?.id) === installationId,
      )
    )
      return true;
    if (installations.length < 100) return false;
  }
  return false;
}

export async function getGithubInstallation(
  installationId: string,
): Promise<GithubInstallationMetadata> {
  const env = githubAppEnv();
  const url = githubApiUrl(
    env.GITHUB_API_URL,
    `app/installations/${encodeURIComponent(installationId)}`,
  );
  const response = await githubFetch(url, {
    headers: apiHeaders(createGithubAppJwt()),
  });
  if (response.status === 404) throw new GithubAppError("NOT_FOUND");
  if (!response.ok) throw new GithubAppError("UNAUTHORIZED");
  const body = (await response.json()) as Record<string, unknown>;
  const account = body.account as Record<string, unknown> | undefined;
  if (String(body.id) !== installationId || account === undefined)
    throw new GithubAppError("UNAVAILABLE");
  return {
    installationId,
    accountId: String(account.id),
    accountLogin: String(account.login),
    accountType: String(account.type),
    repositorySelection: String(body.repository_selection),
  };
}

export async function createInstallationToken(
  installationId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const env = githubAppEnv();
  const url = githubApiUrl(
    env.GITHUB_API_URL,
    `app/installations/${encodeURIComponent(installationId)}/access_tokens`,
  );
  const response = await githubFetch(url, {
    method: "POST",
    headers: apiHeaders(createGithubAppJwt()),
  });
  if (response.status === 404) throw new GithubAppError("NOT_FOUND");
  if (!response.ok) throw new GithubAppError("UNAUTHORIZED");
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.token !== "string" || typeof body.expires_at !== "string")
    throw new GithubAppError("UNAVAILABLE");
  return { token: body.token, expiresAt: new Date(body.expires_at) };
}

function repositoryMetadata(value: unknown): GithubRepositoryMetadata | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const owner = row.owner as Record<string, unknown> | undefined;
  if (
    typeof row.id !== "number" ||
    typeof row.name !== "string" ||
    typeof row.full_name !== "string" ||
    typeof row.default_branch !== "string" ||
    typeof row.html_url !== "string" ||
    typeof row.private !== "boolean" ||
    owner === undefined ||
    typeof owner.login !== "string"
  )
    return null;
  return {
    externalRepositoryId: String(row.id),
    owner: owner.login,
    name: row.name,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    htmlUrl: row.html_url,
    private: row.private,
  };
}

export async function listInstallationRepositories(
  installationId: string,
): Promise<GithubRepositoryMetadata[]> {
  const env = githubAppEnv();
  let { token } = await createInstallationToken(installationId);
  const result: GithubRepositoryMetadata[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = githubApiUrl(env.GITHUB_API_URL, "installation/repositories", {
      per_page: "100",
      page: String(page),
    });
    let response = await githubFetch(url, { headers: apiHeaders(token) });
    if (response.status === 401) {
      token = (await createInstallationToken(installationId)).token;
      response = await githubFetch(url, { headers: apiHeaders(token) });
    }
    if (!response.ok)
      throw new GithubAppError(
        response.status === 401 ? "UNAUTHORIZED" : "UNAVAILABLE",
      );
    const body = (await response.json()) as { repositories?: unknown };
    const rows = Array.isArray(body.repositories) ? body.repositories : [];
    const parsed = rows
      .map(repositoryMetadata)
      .filter((row): row is GithubRepositoryMetadata => row !== null);
    result.push(...parsed);
    if (rows.length < 100) break;
  }
  return result;
}

export async function getInstallationRepository(
  installationId: string,
  repositoryId: string,
): Promise<GithubRepositoryMetadata> {
  const env = githubAppEnv();
  let { token } = await createInstallationToken(installationId);
  const url = githubApiUrl(
    env.GITHUB_API_URL,
    `repositories/${encodeURIComponent(repositoryId)}`,
  );
  let response = await githubFetch(url, { headers: apiHeaders(token) });
  if (response.status === 401) {
    token = (await createInstallationToken(installationId)).token;
    response = await githubFetch(url, { headers: apiHeaders(token) });
  }
  if (response.status === 404) throw new GithubAppError("NOT_FOUND");
  if (!response.ok) throw new GithubAppError("UNAUTHORIZED");
  const parsed = repositoryMetadata(await response.json());
  if (parsed === null || parsed.externalRepositoryId !== repositoryId)
    throw new GithubAppError("UNAVAILABLE");
  return parsed;
}
