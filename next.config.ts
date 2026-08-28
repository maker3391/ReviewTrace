import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route 문자열을 타입으로 검증한다. 오타 난 링크가 빌드에서 걸린다.
  typedRoutes: true,

  // cacheComponents 는 켜지 않는다.
  // 조회 화면은 URL Search Params 로 갈리는 요청별 렌더가 기본이고(CLAUDE.md 8),
  // 지금 캐시로 해결해야 할 성능 문제가 없다. 필요가 실제로 생기면 그때 켠다.
};

export default nextConfig;
