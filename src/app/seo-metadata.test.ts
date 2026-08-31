import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { APP_CONFIG } from "@/config/app";

describe("검색 metadata route", () => {
  it("robots.txt가 sitemap을 운영 도메인으로 안내하고 private 경로를 막는다", () => {
    const result = robots();

    expect(result.sitemap).toBe(`${APP_CONFIG.url}/sitemap.xml`);
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: ["/", "/login", "/icon.png", "/logo.png", "/sitemap.xml"],
      disallow: ["/api/", "/invite/", "/w/"],
    });
  });

  it("sitemap에는 실제 indexable 공개 페이지인 로그인 화면만 싣는다", () => {
    expect(sitemap()).toEqual([
      {
        url: `${APP_CONFIG.url}/login`,
        changeFrequency: "monthly",
        priority: 1,
      },
    ]);
  });
});
