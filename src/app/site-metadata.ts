import type { Metadata } from "next";

import { APP_CONFIG } from "@/config/app";

export const SITE_METADATA: Metadata = {
  metadataBase: new URL(APP_CONFIG.url),
  title: {
    default: APP_CONFIG.name,
    template: `%s · ${APP_CONFIG.name}`,
  },
  description: APP_CONFIG.description,
  verification: {
    other: {
      "naver-site-verification":
        "0ac9ac3684016c79bf8d5852c04d93e95b120ce3",
    },
  },
  openGraph: {
    type: "website",
    url: `${APP_CONFIG.url}/`,
    siteName: APP_CONFIG.name,
    title: APP_CONFIG.name,
    description: APP_CONFIG.description,
  },
};

export const LANDING_METADATA: Metadata = {
  title: { absolute: APP_CONFIG.name },
  description: APP_CONFIG.description,
  alternates: { canonical: `${APP_CONFIG.url}/` },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: `${APP_CONFIG.url}/`,
    siteName: APP_CONFIG.name,
    title: APP_CONFIG.name,
    description: APP_CONFIG.description,
  },
};
