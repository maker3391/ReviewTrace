import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "./client.mjs";
import { ConfigError, loadConfig } from "./config.mjs";
import { normalizeCredentialApiUrl } from "./credential-url.mjs";

const ORIGINAL_URL = process.env.REVIEWTRACE_API_URL;
const ORIGINAL_KEY = process.env.REVIEWTRACE_API_KEY;

beforeEach(() => {
  process.env.REVIEWTRACE_API_KEY = `ci_${"x".repeat(43)}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_URL === undefined) delete process.env.REVIEWTRACE_API_URL;
  else process.env.REVIEWTRACE_API_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.REVIEWTRACE_API_KEY;
  else process.env.REVIEWTRACE_API_KEY = ORIGINAL_KEY;
});

describe("ReviewTrace credential URL", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://reviewtrace.app",
    "https://reviewtrace.example:8443",
  ])("HTTPS self-host와 loopback HTTP를 허용한다: %s", (value) => {
    expect(() => normalizeCredentialApiUrl(value)).not.toThrow();
  });

  it.each([
    "http://reviewtrace.app",
    "ftp://reviewtrace.app",
    "https://user:pass@reviewtrace.app",
    "https://reviewtrace.app/path",
    "https://reviewtrace.app?target=other",
    "https://reviewtrace.app#fragment",
  ])("credential을 안전하게 보낼 수 없는 URL을 거절한다: %s", (value) => {
    expect(() => normalizeCredentialApiUrl(value)).toThrow();
  });

  it("configuration loading 단계에서 원격 HTTP를 fail-fast 한다", () => {
    process.env.REVIEWTRACE_API_URL = "http://reviewtrace.example";

    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("request 직전에도 검증하고 redirect를 따르지 않는다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ issues: [] }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      apiUrl: "https://self-hosted.example",
      apiKey: `ci_${"x".repeat(43)}`,
    });

    await client.searchIssues({ limit: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(url.origin).toBe("https://self-hosted.example");
    expect(init.headers.authorization).toMatch(/^Bearer ci_/);
    expect(init.redirect).toBe("error");
  });
});
