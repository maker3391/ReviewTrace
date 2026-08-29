/**
 * 한국어 문구. **이 파일이 사전의 정본 타입이다.**
 *
 * 🔴 **`as const` 를 붙이지 않는다.** 붙이면 값이 리터럴 타입이 되어 `en: Messages` 가
 * 같은 «문자열»까지 요구하게 된다 — 번역이 아예 불가능해진다.
 *
 * 🔴 **Domain 값을 여기 담지 않는다**(CLAUDE.md 2·13). `CRITICAL` · `TRANSACTION` ·
 * `OPEN` · `RESOLVED` · `patternKey` · 파일 경로 · commit SHA 는 Agent 가 보내고 API 가
 * 계약으로 쓰는 값이라 **양쪽 언어에서 그대로 영어**다. Badge 안의 낱말을 번역하면
 * 화면과 데이터가 갈라진다.
 *
 * 🔴 **이 제품의 Domain 명사(Workspace · Project · Repository · Review · Issue · Pattern ·
 * Agent · API Key · Wiki)는 한국어 문장 안에서도 영어로 둔다.** 저장소가 원래 쓰던 문체이고,
 * 화면의 낱말과 Database·API 의 낱말이 같아야 옮겨 적을 때 헷갈리지 않는다.
 *
 * 값에 다른 값을 끼워 넣어야 하면 **함수**로 둔다. 형식 문자열 라이브러리를 들이지 않는다
 * (CLAUDE.md 18) — 지원 언어가 둘이고 복수형 규칙을 쓰는 자리가 없다.
 */
export const ko = {
  common: {
    /** Section 머리의 「더 보기」. */
    viewAll: "전체 보기",
  },

  appearance: {
    theme: "테마",
    themeLight: "라이트",
    themeDark: "다크",
    themeSystem: "시스템",
    language: "언어",
    localeKo: "한국어",
    localeEn: "English",
  },

  nav: {
    primary: "주요 메뉴",
    breadcrumb: "현재 위치",
    /** 사이드바에서 Project 묶음 위에 붙는 머리글. */
    projectHeading: "PROJECT",
    expand: "사이드바 펼치기",
    collapse: "사이드바 접기",
    workspaceLabel: "Workspace",
    personal: "Personal",
    createWorkspace: "Workspace 만들기",
    noName: "이름 없음",
    signOut: "로그아웃",
    /**
     * 메뉴 이름.
     *
     * 🔴 **키는 `config/navigation.ts` 의 것을 그대로 쓴다.** 그래야 메뉴를 하나 더할 때
     * 여기 문구가 빠지면 typecheck 가 깨진다 — 「사이드바에는 있는데 이름이 없는」 항목이
     * 조용히 생기지 않는다.
     *
     * Section 이름은 **양쪽 언어에서 같다.** 이 제품의 Domain 명사이자 주소의 조각이라
     * 옮기면 화면과 URL 이 갈라진다.
     */
    workspace: {
      DASHBOARD: "Dashboard",
      PROJECTS: "Projects",
      WIKI: "Wiki",
      MEMBERS: "Members",
      SETTINGS: "Settings",
    },
    project: {
      OVERVIEW: "Overview",
      REVIEWS: "Reviews",
      ISSUES: "Issues",
      WIKI: "Wiki",
      REPOSITORIES: "Repositories",
      SETTINGS: "Settings",
    },
  },

  login: {
    /** 🔴 실패 사유를 나누어 보여 주지 않는다(CLAUDE.md 19). */
    error: "로그인하지 못했습니다. 잠시 뒤 다시 시도하세요.",
    continueWithGithub: "GitHub으로 계속하기",
    hint: "GitHub 계정으로 시작합니다. 처음 이용하는 경우 계정이 자동으로 생성됩니다.",
  },

  workspaceDialog: {
    title: "Workspace 만들기",
    description: "팀·조직 단위입니다. 멤버와 API Key 의 경계가 됩니다.",
    name: "이름",
    submit: "만들기",
    submitting: "만드는 중",
  },

  projectDialog: {
    trigger: "Project 만들기",
    title: "Project 만들기",
    description: "하나의 제품 또는 업무 단위입니다. Repository 는 이 아래에 붙습니다.",
    name: "이름",
    slug: "slug",
    optional: "(선택)",
    slugPlaceholder: "비워 두면 이름에서 만듭니다",
    slugHint: (workspaceSlug: string) =>
      `주소에 쓰입니다 — /w/${workspaceSlug}/p/{slug}`,
    descriptionField: "설명",
    submit: "만들기",
    submitting: "만드는 중",
  },

  workspaceDashboard: {
    description: "이 Workspace 전체의 Review 상태",
    kpiReviews: "Reviews",
    kpiIssuesFound: "Issues Found",
    kpiResolved: "Resolved",
    kpiOpen: "Open",
    hintLast30Days: "최근 30일",
    hintOpenNow: "현재 열려 있는 전체",
    projects: {
      title: "Projects",
      empty: "Project 가 없습니다",
      emptyHint:
        "Repository 는 Project 아래에 붙습니다. 제품·업무 단위로 하나 만드세요.",
      colProject: "Project",
      colRepositories: "Repositories",
      colReviews: "Reviews",
      colOpen: "Open",
      colLastActivity: "최근 활동",
    },
    needsAttention: {
      title: "Needs Attention",
      description: "급한 것부터, 같은 등급 안에서는 오래된 것부터",
      empty: "열려 있는 Issue 가 없습니다",
      colSeverity: "Severity",
      colIssue: "Issue",
      colProject: "Project",
      colAge: "Age",
    },
    patterns: {
      title: "Frequent Patterns",
      description: "반복되는 문제",
      empty: "Pattern 이 없습니다",
      emptyHint: "Agent 가 Review 에 patternKey 를 함께 보내면 여기에 쌓입니다.",
      resolved: (count: number) => `해결 ${count}`,
    },
    activity: {
      title: "Recent Activity",
      description: "Review 실행과 해결 기록",
      empty: "활동이 없습니다",
      /** 행위자 이름은 굵게 따로 그린다 — 여기 담기는 것은 그 뒤에 붙는 말이다. */
      reviewSuffix: (repository: string, issueCount: number) =>
        ` 가 ${repository} 검토 — Issue ${issueCount}건`,
      resolutionSuffix: (repository: string) => ` 해결 — ${repository}`,
    },
  },

  projectDashboard: {
    kpiReviews: "Reviews",
    kpiIssues: "Issues",
    kpiOpen: "Open",
    kpiResolutionRate: "Resolution Rate",
    hintLast30Days: "최근 30일",
    hintNow: "현재",
    hintFoundLast30Days: "최근 30일 발견분",
    openIssues: {
      title: "Open Issues",
      empty: "열려 있는 Issue 가 없습니다.",
      colSeverity: "Severity",
      colIssue: "Issue",
      colLocation: "Repository · Location",
      colAge: "Age",
    },
    patterns: {
      title: "Frequent Patterns",
      empty: "Pattern 이 없습니다.",
      colPattern: "Pattern",
      colCategory: "Category",
      colOccurrences: "발생",
      colResolved: "해결",
      colLast: "최근",
    },
    recentReviews: {
      title: "Recent Reviews",
      empty: "Review 가 없습니다.",
      colReviewer: "Reviewer",
      colRepository: "Repository",
      colTarget: "Target",
      colIssues: "Issues",
      colDate: "Date",
    },
    repositories: {
      title: "Repositories",
      empty: "Repository 가 없습니다. Agent 가 Review 를 보내면 등록됩니다.",
      colRepository: "Repository",
      colReviews: "Reviews",
      colOpen: "Open",
      colLastReview: "최근 Review",
    },
    wiki: {
      title: "Wiki",
      description: "사람이 적은 문서",
      empty: "문서가 없습니다.",
    },
    resolutions: {
      title: "Recent Resolutions",
      description: "Review 가 남긴 해결 기록",
      empty: "해결 기록이 없습니다.",
    },
  },

  projects: {
    title: "Projects",
    description: "하나의 제품 또는 업무 단위. Repository 는 Project 아래에 붙습니다.",
    empty: "Project 가 없습니다",
    emptyHint: "제품·업무 단위로 하나 만드세요 — 예: SMIL, ReviewTrace, ERP.",
    colProject: "Project",
    colSlug: "slug",
    colRepositories: "Repositories",
    colReviews: "Reviews",
    colOpenIssues: "Open Issues",
    colLastActivity: "최근 활동",
  },

  issues: {
    title: "Issues",
    description: (projectName: string) =>
      `${projectName} 에서 Agent 와 사람이 남긴 Code Issue`,
    filter: {
      search: "검색",
      searchPlaceholder: "제목 · 파일 · Pattern",
      severity: "Severity",
      category: "Category",
      status: "Status",
      allSeverity: "모든 Severity",
      allCategory: "모든 Category",
      allStatus: "모든 Status",
      submit: "조회",
      submitting: "조회 중",
      reset: "초기화",
    },
    empty: "조건에 맞는 Issue 가 없습니다.",
    emptyHint:
      "Filter 를 넓히거나, Agent 가 Review 결과를 아직 보내지 않았는지 확인하세요.",
    colSeverity: "Severity",
    colTitle: "Title",
    colCategory: "Category",
    colLocation: "Location",
    colStatus: "Status",
    colDetected: "Detected",
    pagination: (total: number, from: number, to: number) =>
      `전체 ${total}건 중 ${from}–${to}`,
  },

  reviews: {
    title: "Reviews",
    description: (projectName: string) =>
      `${projectName} 에서 실행된 Code Review`,
    empty: "Review 가 없습니다",
    emptyHint: "Agent 가 POST /api/v1/reviews 로 결과를 보내면 여기에 쌓입니다.",
    colReviewer: "Reviewer",
    colRepository: "Repository",
    colTarget: "Target",
    colBranchCommit: "Branch · Commit",
    colIssues: "Issues",
    colDate: "Date",
  },

  repositories: {
    title: "Repositories",
    description: (projectName: string) => `${projectName} 의 코드베이스`,
    empty: "Repository 가 없습니다",
    emptyHint: "Agent 가 이 Project 로 Review 를 보내면 자동으로 등록됩니다.",
    colRepository: "Repository",
    colDefaultBranch: "Default Branch",
    colReviews: "Reviews",
    colOpenIssues: "Open Issues",
    colLastReview: "최근 Review",
  },

  wiki: {
    workspaceHeading: "Workspace Wiki",
    workspaceDescription: "Project 를 가리지 않고 지켜야 하는 규칙",
    projectHeading: "Project Wiki",
    projectDescription: (projectName: string) =>
      `${projectName} 안에서만 뜻이 있는 규칙과 기록`,
    create: "문서 작성",
    empty: "문서가 없습니다",
    emptyHint: "반복해서 설명하게 되는 규칙부터 적어 두세요.",
    colTitle: "제목",
    colSlug: "slug",
    colAuthor: "작성자",
    colUpdated: "수정",
  },

  notFound: {
    title: "없는 주소입니다.",
    back: "Dashboard 로",
  },

  date: {
    today: "오늘",
    days: (count: number) => `${count}일`,
  },
};

/**
 * 사전의 모양.
 *
 * 🔴 **정본은 한국어다.** `en.ts` 가 이 타입을 그대로 받으므로 **키가 하나라도 빠지면
 * typecheck 가 깨진다** — 그것이 라이브러리 없이 이 방식을 고른 이유다(CLAUDE.md 18).
 */
export type Messages = typeof ko;
