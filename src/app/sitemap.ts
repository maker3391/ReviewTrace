import type { MetadataRoute } from "next";

import { APP_CONFIG } from "@/config/app";

/** 실제로 200 응답하며 공개 색인이 가능한 페이지만 싣는다. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${APP_CONFIG.url}/login`,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
