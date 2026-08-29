import type { Messages } from "@/config/messages/ko";

/**
 * 영어 문구.
 *
 * 🔴 **`Messages` 를 그대로 받는다.** 한국어 사전에 키가 하나 늘면 여기서 곧바로
 * typecheck 가 깨진다 — 「어떤 화면만 번역이 빠진」 상태를 사람이 눈으로 찾지 않는다.
 *
 * 🔴 **Domain 값과 Domain 명사는 한국어 사전과 «같은» 낱말이다**(`ko.ts` 머리말).
 * Severity·Category·Status·Pattern·Repository 같은 낱말이 여기서만 달라지면
 * 화면과 API 계약이 갈라진다.
 */
export const en: Messages = {
  common: {
    viewAll: "View all",
  },

  appearance: {
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    language: "Language",
    localeKo: "한국어",
    localeEn: "English",
  },

  nav: {
    primary: "Main menu",
    breadcrumb: "Current location",
    projectHeading: "PROJECT",
    expand: "Expand sidebar",
    collapse: "Collapse sidebar",
    workspaceLabel: "Workspace",
    personal: "Personal",
    createWorkspace: "New workspace",
    noName: "No name",
    signOut: "Sign out",
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
    error: "Sign-in failed. Please try again in a moment.",
    continueWithGithub: "Continue with GitHub",
    hint: "Sign in with GitHub. Your account is created automatically on first use.",
  },

  workspaceDialog: {
    title: "New workspace",
    description:
      "A team or organization. It is the boundary for members and API keys.",
    name: "Name",
    submit: "Create",
    submitting: "Creating",
  },

  projectDialog: {
    trigger: "New project",
    title: "New project",
    description:
      "One product or unit of work. Repositories live under a project.",
    name: "Name",
    slug: "slug",
    optional: "(optional)",
    slugPlaceholder: "Leave empty to derive it from the name",
    slugHint: (workspaceSlug: string) =>
      `Used in the URL — /w/${workspaceSlug}/p/{slug}`,
    descriptionField: "Description",
    submit: "Create",
    submitting: "Creating",
  },

  workspaceDashboard: {
    description: "Review status across this workspace",
    kpiReviews: "Reviews",
    kpiIssuesFound: "Issues Found",
    kpiResolved: "Resolved",
    kpiOpen: "Open",
    hintLast30Days: "Last 30 days",
    hintOpenNow: "Currently open",
    projects: {
      title: "Projects",
      empty: "No projects yet",
      emptyHint:
        "Repositories live under a project. Create one per product or unit of work.",
      colProject: "Project",
      colRepositories: "Repositories",
      colReviews: "Reviews",
      colOpen: "Open",
      colLastActivity: "Last activity",
    },
    needsAttention: {
      title: "Needs Attention",
      description: "Most severe first, then oldest within the same severity",
      empty: "No open issues",
      colSeverity: "Severity",
      colIssue: "Issue",
      colProject: "Project",
      colAge: "Age",
    },
    patterns: {
      title: "Frequent Patterns",
      description: "Problems that keep coming back",
      empty: "No patterns yet",
      emptyHint:
        "Patterns appear here once an agent sends a patternKey with its review.",
      resolved: (count: number) => `${count} resolved`,
    },
    activity: {
      title: "Recent Activity",
      description: "Review runs and resolutions",
      empty: "No activity yet",
      reviewSuffix: (repository: string, issueCount: number) =>
        ` reviewed ${repository} — ${issueCount} issues`,
      resolutionSuffix: (repository: string) => ` resolved — ${repository}`,
    },
  },

  projectDashboard: {
    kpiReviews: "Reviews",
    kpiIssues: "Issues",
    kpiOpen: "Open",
    kpiResolutionRate: "Resolution Rate",
    hintLast30Days: "Last 30 days",
    hintNow: "Now",
    hintFoundLast30Days: "Found in the last 30 days",
    openIssues: {
      title: "Open Issues",
      empty: "No open issues.",
      colSeverity: "Severity",
      colIssue: "Issue",
      colLocation: "Repository · Location",
      colAge: "Age",
    },
    patterns: {
      title: "Frequent Patterns",
      empty: "No patterns yet.",
      colPattern: "Pattern",
      colCategory: "Category",
      colOccurrences: "Occurrences",
      colResolved: "Resolved",
      colLast: "Last seen",
    },
    recentReviews: {
      title: "Recent Reviews",
      empty: "No reviews yet.",
      colReviewer: "Reviewer",
      colRepository: "Repository",
      colTarget: "Target",
      colIssues: "Issues",
      colDate: "Date",
    },
    repositories: {
      title: "Repositories",
      empty: "No repositories yet. They register when an agent sends a review.",
      colRepository: "Repository",
      colReviews: "Reviews",
      colOpen: "Open",
      colLastReview: "Last review",
    },
    wiki: {
      title: "Wiki",
      description: "Written by people",
      empty: "No pages yet.",
    },
    resolutions: {
      title: "Recent Resolutions",
      description: "Resolutions left behind by reviews",
      empty: "No resolutions yet.",
    },
  },

  projects: {
    title: "Projects",
    description:
      "One product or unit of work. Repositories live under a project.",
    empty: "No projects yet",
    emptyHint:
      "Create one per product or unit of work — e.g. SMIL, ReviewTrace, ERP.",
    colProject: "Project",
    colSlug: "slug",
    colRepositories: "Repositories",
    colReviews: "Reviews",
    colOpenIssues: "Open Issues",
    colLastActivity: "Last activity",
  },

  issues: {
    title: "Issues",
    description: (projectName: string) =>
      `Code issues left by agents and people in ${projectName}`,
    filter: {
      search: "Search",
      searchPlaceholder: "Title · file · pattern",
      severity: "Severity",
      category: "Category",
      status: "Status",
      allSeverity: "All severities",
      allCategory: "All categories",
      allStatus: "All statuses",
      submit: "Search",
      submitting: "Searching",
      reset: "Reset",
    },
    empty: "No issues match these filters.",
    emptyHint:
      "Widen the filters, or check whether an agent has sent review results yet.",
    colSeverity: "Severity",
    colTitle: "Title",
    colCategory: "Category",
    colLocation: "Location",
    colStatus: "Status",
    colDetected: "Detected",
    pagination: (total: number, from: number, to: number) =>
      `${from}–${to} of ${total}`,
  },

  reviews: {
    title: "Reviews",
    description: (projectName: string) =>
      `Code reviews run in ${projectName}`,
    empty: "No reviews yet",
    emptyHint:
      "Reviews appear here once an agent posts results to POST /api/v1/reviews.",
    colReviewer: "Reviewer",
    colRepository: "Repository",
    colTarget: "Target",
    colBranchCommit: "Branch · Commit",
    colIssues: "Issues",
    colDate: "Date",
  },

  repositories: {
    title: "Repositories",
    description: (projectName: string) => `Codebases of ${projectName}`,
    empty: "No repositories yet",
    emptyHint:
      "A repository registers itself when an agent sends a review to this project.",
    colRepository: "Repository",
    colDefaultBranch: "Default Branch",
    colReviews: "Reviews",
    colOpenIssues: "Open Issues",
    colLastReview: "Last review",
  },

  wiki: {
    workspaceHeading: "Workspace Wiki",
    workspaceDescription: "Rules that hold across every project",
    projectHeading: "Project Wiki",
    projectDescription: (projectName: string) =>
      `Rules and records that only mean something inside ${projectName}`,
    create: "New page",
    empty: "No pages yet",
    emptyHint: "Start with the rules you keep having to explain.",
    colTitle: "Title",
    colSlug: "slug",
    colAuthor: "Author",
    colUpdated: "Updated",
  },

  notFound: {
    title: "This address does not exist.",
    back: "Back to dashboard",
  },

  date: {
    today: "Today",
    days: (count: number) => `${count}d`,
  },
};
