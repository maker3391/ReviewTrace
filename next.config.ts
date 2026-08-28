import type { NextConfig } from "next";

/**
 * 모든 응답에 붙는 보안 헤더.
 *
 * 🔴 **이것은 브라우저에게 «무엇을 하지 마라»를 알려 주는 자리다.** 서버 판정
 * (`requireWorkspace` · `authenticateAgent`)을 대신하지 않는다 — 그 앞에서 브라우저가
 * 스스로 저지를 수 있는 일을 줄일 뿐이다.
 *
 * 무엇을 «넣지 않았는지»가 넣은 것만큼 중요하다.
 *
 * 🔴 **`script-src` CSP 를 넣지 않았다.** Next.js 는 hydration bootstrap 을 inline
 * `<script>` 로 내보내고 Turbopack dev 는 `eval` 을 쓴다. 제대로 하려면 요청마다 nonce 를
 * 만들어 Proxy 가 심어야 하는데(그러면 Proxy 가 판정하지 않는 자리라는 성질이 깨진다),
 * 얻는 것은 크지 않다 — 이 앱에는 `dangerouslySetInnerHTML` 이 한 곳도 없고 Markdown 은
 * raw HTML 을 만들지 않는다(`components/molecules/MarkdownView.tsx`). 즉 CSP 가 막아 줄
 * 주입 지점이 지금은 없다. `'unsafe-inline' 'unsafe-eval'` 이 들어간 CSP 를 적어 두면
 * 「CSP 가 있다」는 착각만 남는다. 사후 정화 Library 도 같은 이유로 넣지 않는다(CLAUDE.md 18).
 */
const SECURITY_HEADERS = [
  /**
   * 🔴 화면 전체가 남의 페이지 안에 끼워지는 것을 막는다(Clickjacking).
   *
   * 이 제품의 위험한 동작은 전부 «한 번 누르면 끝나는» Server Action 이다 —
   * Project 삭제 · API Key 폐기 · 멤버 역할 변경. 투명하게 덮어씌운 iframe 위에서
   * 누르게 만들면 CSRF 방어(Origin 검사·SameSite)를 전혀 건드리지 않고 통과한다.
   * 요청이 진짜 그 사람의 브라우저에서, 진짜 우리 화면 위에서 나기 때문이다.
   *
   * `frame-ancestors` 가 정본이고 `X-Frame-Options` 는 그것을 모르는 구형 브라우저용이다.
   */
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },

  /**
   * 선언한 Content-Type 을 브라우저가 제 마음대로 다시 추측하지 못하게 한다.
   *
   * Agent API 는 Issue 제목·설명을 **그대로** JSON 으로 돌려준다(그것이 계약이다).
   * 그 안에 `<script>` 가 들어 있어도 `application/json` 인 한 문서로 실행되지 않는데,
   * sniffing 을 허용하면 그 전제가 브라우저 판단에 맡겨진다.
   */
  { key: "X-Content-Type-Options", value: "nosniff" },

  /**
   * 🔴 주소에 Tenant 가 들어 있다 — `/w/{workspaceSlug}/p/{projectSlug}/...`.
   *
   * 기본 정책이면 바깥 사이트로 나가는 요청에 그 전체 경로가 Referer 로 실린다.
   * Wiki 본문의 링크 하나를 누르는 것만으로 Workspace 이름과 Project 이름이 남의 서버
   * 로그에 남는다(CLAUDE.md 11 — URL 에 식별 정보를 담지 않는다는 규칙의 뒷면이다).
   * 교차 출처에는 origin 까지만 보낸다.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  /**
   * 쓰지 않는 장치 권한을 꺼 둔다. 이 앱은 카메라·마이크·위치를 쓸 일이 없다 —
   * 나중에 어떤 화면이 실수로 요청해도 브라우저가 먼저 막는다.
   */
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

/**
 * HTTPS 강제.
 *
 * 🔴 **production 에서만 붙인다.** localhost 는 http 라 브라우저가 어차피 무시하지만,
 * 개발 중 한 번이라도 https 로 접속하면 그 호스트가 브라우저에 «고정»돼 이후 http 접속이
 * 통째로 막힌다. 개발자를 스스로 잠그는 헤더를 dev 에 두지 않는다.
 */
const HSTS = {
  key: "Strict-Transport-Security",
  value: "max-age=31536000; includeSubDomains",
};

const nextConfig: NextConfig = {
  // Route 문자열을 타입으로 검증한다. 오타 난 링크가 빌드에서 걸린다.
  typedRoutes: true,

  // cacheComponents 는 켜지 않는다.
  // 조회 화면은 URL Search Params 로 갈리는 요청별 렌더가 기본이고(CLAUDE.md 8),
  // 지금 캐시로 해결해야 할 성능 문제가 없다. 필요가 실제로 생기면 그때 켠다.

  async headers() {
    return [
      {
        // 화면·Agent API·정적 자원 전부. 경로마다 나눠 적으면 새 경로가 빠진다.
        source: "/:path*",
        headers:
          process.env.NODE_ENV === "production"
            ? [...SECURITY_HEADERS, HSTS]
            : SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
