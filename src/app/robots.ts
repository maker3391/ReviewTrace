import type { MetadataRoute } from "next";

import { APP_CONFIG } from "@/config/app";

/**
 * 검색 가치가 없는 인증/API/Tenant 경로의 crawl 만 줄인다.
 * 실제 private data 보호는 Proxy 와 서버 권한 검사가 계속 맡는다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/icon.png", "/logo.png", "/sitemap.xml"],
      disallow: ["/api/", "/invite/", "/w/"],
    },
    sitemap: `${APP_CONFIG.url}/sitemap.xml`,
    host: APP_CONFIG.url,
  };
}
