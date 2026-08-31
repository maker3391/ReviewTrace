import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { LANDING_METADATA, SITE_METADATA } from "@/app/site-metadata";
import { APP_CONFIG } from "@/config/app";

describe("검색 metadata route", () => {
  it("robots.txt가 sitemap을 운영 도메인으로 안내하고 private 경로를 막는다", () => {
    const result = robots();

    expect(result.sitemap).toBe(`${APP_CONFIG.url}/sitemap.xml`);
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: ["/", "/icon.png", "/logo.png", "/sitemap.xml"],
      disallow: ["/api/", "/invite/", "/w/"],
    });
  });

  it("sitemap에는 공식 공개 root만 싣고 중복 login URL은 넣지 않는다", () => {
    expect(sitemap()).toEqual([
      {
        url: `${APP_CONFIG.url}/`,
        changeFrequency: "monthly",
        priority: 1,
      },
    ]);
  });

  it("공식 root metadata는 index/follow와 대표 URL을 명시한다", () => {
    expect(LANDING_METADATA).toMatchObject({
      title: { absolute: APP_CONFIG.name },
      description: APP_CONFIG.description,
      alternates: { canonical: `${APP_CONFIG.url}/` },
      robots: { index: true, follow: true },
      openGraph: {
        url: `${APP_CONFIG.url}/`,
        title: APP_CONFIG.name,
        description: APP_CONFIG.description,
      },
    });
  });

  it("site metadata의 운영 도메인과 Naver 소유 확인 값을 유지한다", () => {
    expect(SITE_METADATA.metadataBase).toEqual(new URL(APP_CONFIG.url));
    expect(SITE_METADATA.verification).toMatchObject({
      other: {
        "naver-site-verification":
          "0ac9ac3684016c79bf8d5852c04d93e95b120ce3",
      },
    });
  });
});
