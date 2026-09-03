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

    pagination: {
      total: (total: number) => `${total} total`,
      previous: "Previous page",
      next: "Next page",
      pageSize: "Rows per page",
      page: (page: number) => `Page ${page}`,
      navigation: "Pagination",
    },
  },

  /** 🔴 값은 그대로다. 여기 있는 것은 화면에 보이는 글자뿐이다(`ko.ts` 머리말). */
  enums: {
    severity: {
      CRITICAL: "Critical",
      HIGH: "High",
      MEDIUM: "Medium",
      LOW: "Low",
      INFO: "Info",
    },
    status: {
      OPEN: "Open",
      IN_PROGRESS: "In progress",
      RESOLVED: "Resolved",
      IGNORED: "Ignored",
      FALSE_POSITIVE: "False positive",
      REOPENED: "Reopened",
    },
    category: {
      ARCHITECTURE: "Architecture",
      SECURITY: "Security",
      PERFORMANCE: "Performance",
      DATABASE: "Database",
      TRANSACTION: "Transaction",
      CONCURRENCY: "Concurrency",
      API: "API",
      VALIDATION: "Validation",
      EXCEPTION_HANDLING: "Exception handling",
      TESTING: "Testing",
      CLEAN_CODE: "Clean code",
      RELIABILITY: "Reliability",
    },
    activityType: {
      DETECTED: "Detected",
      FIX_ATTEMPTED: "Fix attempted",
      REVIEWED_AGAIN: "Reviewed again",
      RESOLVED: "Resolved",
      REOPENED: "Reopened",
      IGNORED: "Ignored",
      COMMENT: "Comment",
    },
    targetType: {
      PULL_REQUEST: "Pull Request",
      COMMIT: "Commit",
      BRANCH: "Branch",
      REPOSITORY: "Repository",
      MANUAL: "Manual",
    },
    reviewerType: {
      AGENT: "Agent",
      HUMAN: "Human",
      SYSTEM: "System",
    },
    provider: {
      GITHUB: "GitHub",
    },
    role: {
      OWNER: "Owner",
      MEMBER: "Member",
    },
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
    continueWithGithub: "Sign in with GitHub",

    headlineLead: "Turn code reviews",
    headlineAccent: "into engineering memory.",
    headlineTail: "",
    subhead:
      "Keep what your coding agents found and why they fixed it that way — tied to the actual code — so the next review can pick up the same reasoning.",
    features: [
      {
        title: "From finding to resolution",
        body: "Detection, fix attempts, re-review, and resolution stay in one history.",
      },
      {
        title: "Anchored to the code",
        body: "Commit, file, and line range are attached and verified against GitHub.",
      },
      {
        title: "The reasoning survives",
        body: "The chosen solution, rejected alternatives, and trade-offs stay with the issue.",
      },
    ],

    agentSupport: "Coding agent integration",

    showcaseIssue: "State changes executed outside the transaction",
    showcaseDecision:
      "Resolution and Activity are committed in the same transaction, preventing partially persisted state.",

    license: "License",
    docs: "Docs",
  },

  workspaceDialog: {
    title: "New workspace",
    description: "The boundary for members and API keys.",
    name: "Name",
    submit: "Create",
    submitting: "Creating",
  },

  projectDialog: {
    trigger: "New project",
    title: "New project",
    description: "Repositories live under a project.",
    name: "Name",
    slug: "slug",
    optional: "(optional)",
    slugPlaceholder: "Leave empty to derive it from the name",
    slugHint: (workspaceSlug: string) =>
      `Used in the URL · /w/${workspaceSlug}/p/{slug}`,
    descriptionField: "Description",
    submit: "Create",
    submitting: "Creating",
  },

  workspaceDashboard: {
    kpiReviews: "Reviews",
    kpiIssuesFound: "Issues Found",
    kpiResolved: "Resolved",
    kpiOpen: "Open",
    hintLast30Days: "Last 30 days",
    hintOpenNow: "Now",
    projects: {
      title: "Projects",
      empty: "No projects yet",
      colProject: "Project",
      colRepositories: "Repositories",
      colReviews: "Reviews",
      colOpen: "Open",
      colLastActivity: "Last activity",
    },
    needsAttention: {
      title: "Needs Attention",
      empty: "No open issues",
      colSeverity: "Severity",
      colIssue: "Issue",
      colProject: "Project",
      colAge: "Age",
    },
    patterns: {
      title: "Frequent Patterns",
      empty: "No patterns yet",
      /**
       * 🔴 두 숫자는 «단위가 다르다». `issues` 는 고유 Issue 수이고 `encounters` 는
       * 최초 발견 + 재발 횟수다 — 낱말 없이 나란히 두면 같은 모집단의 「발생 / 해결」로
       * 읽힌다. 비교되는 쌍(문제 · 해결)만 같은 단위로 둔다.
       */
      encounters: (count: number) => `seen ${count}×`,
      resolved: (count: number) => `${count} resolved`,
    },
    activity: {
      title: "Recent Activity",
      empty: "No activity yet",
      reviewSuffix: (repository: string, issueCount: number) =>
        ` reviewed ${repository} · ${issueCount} issues`,
      resolutionSuffix: (repository: string) => ` resolved · ${repository}`,
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
      colIssues: "Issues",
      encounters: (count: number) => `seen ${count}×`,
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
      empty: "No repositories yet.",
      colRepository: "Repository",
      colReviews: "Reviews",
      colOpen: "Open",
      colLastReview: "Last review",
    },
    wiki: {
      title: "Wiki",
      empty: "No pages yet.",
    },
    resolutions: {
      title: "Recent Resolutions",
      empty: "No resolutions yet.",
    },
  },

  projects: {
    title: "Projects",
    empty: "No projects yet",
    colProject: "Project",
    colSlug: "slug",
    colRepositories: "Repositories",
    colReviews: "Reviews",
    colOpenIssues: "Open Issues",
    colLastActivity: "Last activity",
  },

  issues: {
    title: "Issues",
    filter: {
      search: "Search",
      searchPlaceholder: "Title · file · pattern",
      repository: "Repository",
      severity: "Severity",
      category: "Category",
      status: "Status",
      allRepository: "All repositories",
      allSeverity: "All severities",
      allCategory: "All categories",
      allStatus: "All statuses",
      submit: "Search",
      submitting: "Searching",
      reset: "Reset",
    },
    empty: "No issues match these filters.",
    colSeverity: "Severity",
    colTitle: "Title",
    colCategory: "Category",
    colLocation: "Location",
    colStatus: "Status",
    colDetected: "Detected",
  },

  reviews: {
    title: "Reviews",
    empty: "No reviews yet",
    colReviewer: "Reviewer",
    colRepository: "Repository",
    colTarget: "Target",
    colIssues: "Issues",
    colDate: "Date",
  },

  repositories: {
    title: "Repositories",
    empty: "No repositories yet",
    colRepository: "Repository",
    colDefaultBranch: "Default Branch",
    colReviews: "Reviews",
    colOpenIssues: "Open Issues",
    colLastReview: "Last review",
    connect: "Connect repository",
    installGithub: "Connect GitHub",
    choose: "Repository to connect",
    private: "Private",
    public: "Public",
    connected: "GitHub connected",
    add: "Add repository",
    connectTitle: "Connect a GitHub repository",
    connectDescription: "Connect the GitHub repositories reviewed in this Project.",
    chooseTitle: "Repository to connect",
    /** 🔴 Says what the person can do next, not how our access model is shaped. */
    emptyTitle: "No repositories left to add",
    noAccessible:
      "ReviewTrace cannot reach any GitHub repository yet. Choose the repositories it may use on GitHub.",
    allConnected:
      "Every repository ReviewTrace can currently reach is already connected to this Project. To connect another one, add it to ReviewTrace on GitHub.",
    updateAccess: "Add repositories on GitHub",
    cancel: "Cancel",
    viewGithub: "View on GitHub",
  },

  wiki: {
    workspaceHeading: "Workspace Wiki",
    workspaceDescription: "Rules and records shared by every project",
    projectHeading: "Project Wiki",
    projectDescription: (projectName: string) =>
      `Rules and records for the ${projectName} project`,
    create: "New page",
    empty: "No pages yet",
    colTitle: "Title",
    colSlug: "slug",
    colAuthor: "Author",
    colUpdated: "Updated",

    form: {
      newTitle: "New page",
      editTitle: "Edit page",
      backToList: "Wiki",
      save: "Save",
      saving: "Saving",
      cancel: "Cancel",
      titleLabel: "Document title",
      slugLabel: "Slug (optional)",
      slugPlaceholder: "transaction-boundary",
      slugHint: "Left empty, it comes from the title",
      contentLabel: "Body (Markdown)",
      editor: {
        write: "Write",
        preview: "Preview",
        previewEmpty: "Nothing to preview yet.",
        heading: "Heading",
        bold: "Bold",
        italic: "Italic",
        inlineCode: "Inline code",
        codeBlock: "Code block",
        link: "Link",
        bulletList: "Bullet list",
        numberedList: "Numbered list",
      },
    },
  },

  settings: {
    title: "Settings",
    workspaceSection: "Workspace",
    workspaceName: "Name",
    workspaceKind: "Kind",
    kindPersonal: "Personal workspace",
    kindTeam: "Team workspace",
    myRole: "Your role",
    scale: "Size",
    statProjects: "Projects",
    statMembers: "Members",
    agentCredentialsSection: "Agent connections",
    integrationSection: "Agent Integration",
    accountSection: "Account",
    dangerSection: "Delete workspace",
  },

  /** 🔴 No explanatory sentences — heading, field label, current state, action only. */
  agentCredentials: {
    issue: "Create Agent connection",
    name: "Name",
    readOnly: "Read only",
    readWrite: "Read and write",
    never: "Never expires",
    days30: "30 days",
    days90: "90 days",
    days365: "365 days",
    credentials: "Connected Agents",
    noCredentials: "No Agents are connected.",
    prefix: "Prefix",
    capability: "Capability",
    reviewLanguage: "Review language",
    korean: "한국어",
    english: "English",
    lastUsed: "Last used",
    expires: "Expires",
    status: "Status",
    active: "Active",
    revoke: "Revoke",
    cancel: "Cancel",
    revokeConfirmTitle: "Revoke this Agent connection?",
    revokeConfirmConsequence:
      "Clients using this authentication value will receive 401 from their next request. The connection record is retained.",
    /**
     * 🔴 The wording stays out of the internal auth model — see ko.ts. The behaviour
     * is unchanged: access is granted to the person, not to one connection.
     */
    workspaceAccess: "Workspace access",
    granted: "Allowed",
    notGranted: "Not allowed",
    grant: "Allow",
    /** 🔴 Different from revoking a connection — only this Workspace access goes away. */
    revokeGrant: "Disallow",
    ownerRequired: "Only an OWNER can change this",
    issuedTitle: "Agent connection created",
    issuedWarning:
      "The secret is shown only once. Copy it to a safe place and register it in your MCP client.",
    copy: "Copy",
    copied: "Copied",
    close: "Close",
    /** 🔴 Only usable connections are listed; revoked rows stay in the database. */
    activeConnections: "Active connections",
    neverUsed: "never",
  },

  workspaceDelete: {
    intro:
      "Deleting a workspace removes every review record inside it, and cannot be undone.",
    losses: "Deleted data",
    statProjects: "Projects",
    statRepositories: "Repositories",
    statReviews: "Reviews",
    statIssues: "Issues",
    statPages: "Pages",
    statKeys: "API Keys",
    statInvitations: "Invitations",
    statTags: "Tags",
    blockedTitle: "Resolve this first",
    blockedMembers:
      "A workspace with other members cannot be deleted. Remove the members first.",
    delete: "Delete workspace",
    cancel: "Cancel",
    dialogTitle: "Delete this workspace?",
    dialogBody:
      "Every project, review, issue, page, and API key in this workspace disappears. This cannot be undone.",
    confirmPrefix: "Type ",
    confirmSuffix: " to confirm.",
  },

  account: {
    intro:
      "Deleting your account removes your sign-in details and all sessions, and cannot be undone.",
    willDelete: "Deleted too",
    losses: "Deleted data",
    statProjects: "Projects",
    statIssues: "Issues",
    statPages: "Pages",
    statKeys: "API Keys",
    blockedTitle: "Resolve this first",
    blockedHint:
      "These workspaces have other members but you are their only OWNER. Promote another member to OWNER on the Members screen, then try again.",
    delete: "Delete account",
    cancel: "Cancel",
    dialogTitle: "Delete your account?",
    dialogBody:
      "Workspaces only you belong to disappear along with the review history inside them. This cannot be undone.",
    confirmPrefix: "Type ",
    confirmSuffix: " to confirm.",
  },

  integration: {
    step1: "1. Register",
    step2: "2. Verify",
    copyCommand: (step: string) => `Copy the ${step} command`,
    /* 🔴 Owned by the Section that draws the copy buttons — see ko.ts. */
    copy: "Copy",
    copied: "Copied",
    claudeNote:
      "The configuration is stored in the user scope. Do not use a repository's .mcp.json.",
    codexNote:
      "Register it with the command above instead of editing the config file by hand. " +
      "Write operations require approval before they run.",
    /** 🔴 Leading and trailing spaces are part of the sentence — see ko.ts. */
    keyHint:
      " is where the key you created above goes. Do not store your API key in a repository's ",
    keyHintTail: ".",
  },

  members: {
    title: "Members",
    columnName: "Name",
    columnRole: "Role",
    noName: "No name",
    personalOwner: "Owns this personal workspace",
    invite: "Invite",
    pending: "Pending invitations",
    noPending: "No pending invitations.",
    columnEmail: "Email",
    columnExpires: "Expires",
    inviteEmailLabel: "Email to invite",
    inviteLink: "Invitation link",
    inviteLinkWarning: "Copy it now. This link cannot be shown again.",
    roleLabel: "Role",
    revoke: "Revoke",
    cancel: "Close",
    revokeConfirmTitle: "Revoke this invitation?",
    revokeConfirmDescription:
      "The link already sent can no longer be accepted. You can invite the same email again.",
    remove: "Remove",
    removeConfirmTitle: "Remove this member?",
    removeConfirmDescription:
      "They lose access to this workspace. Their account and everything they left behind stay, and you can invite them again.",
  },

  invite: {
    invalidTitle: "This invitation cannot be used",
    invalidBody:
      "The link has expired or has already been used. Ask whoever invited you to send a new one.",
    title: (workspaceName: string) => `Join ${workspaceName}`,
    body: (email: string) =>
      `${email} was invited. Accepting makes you a member of this workspace.`,
    signInFirst:
      "Sign in with GitHub first. You will come back to this page afterwards.",
    accept: "Accept invitation",
  },

  issueDetail: {
    description: "Description",
    rootCause: "Root cause",
    failurePath: "Failure / attack path",
    suggestion: "Suggestion",
    resolution: "Resolution",
    history: "History",
    noHistory: "No history yet",
    edit: "Edit",
    editTitle: "Edit issue",
    editHint:
      "Refine the issue narrative. Status, history and code evidence are untouched.",
    issueTitle: "Title",
    markdownHint: "Saved exactly as the Markdown source you type.",
    cancelEdit: "Cancel",
    saveEdit: "Save",
    status: "Status",
    location: "Location",
    identity: "Identity",
    tags: "Tags",
    source: "Source",
    detected: "Detected",
    resolvedAt: "Resolved",
    firstReview: "First seen in",
    branch: "Branch",
    lastChanged: "Last changed",
    changeStatus: "Change status",
    changing: "Saving",
    resolutionSummary: "Resolution summary",
    editResolutionSummary: "Edit summary",
    cancelResolutionSummary: "Cancel editing",
    saveResolutionSummary: "Save summary",
    emptyResolutionSummary: "No resolution summary.",
    optional: "(optional)",
    activity: "Activity",
    activityType: "Activity type",
    commit: "Commit",
    commitSha: "Commit SHA",
    activityDescription: "Details",
    recordActions: {
      COMMENT: "Add comment",
      FIX_ATTEMPTED: "Add fix attempt",
      REVIEWED_AGAIN: "Add re-review",
    },
    decision: "Decision record",
    solution: "Solution",
    decisionReason: "Why this approach",
    alternatives: "Alternatives considered",
    tradeOff: "Trade-off",
    verification: "Verification",
    regressionTest: "Regression test",
    residualRisk: "Residual risk",
    codeEvidence: "Code evidence",
    before: "Before fix",
    after: "After fix",
    viewCode: "View on GitHub",
    noSnapshot: "No code snapshot was stored.",
    deletedLines: "Deleted lines",
    addedLines: "Added lines",
    checkedAt: "Checked",
    showAllEvidenceLines: (count: number) => `Show all ${count} lines`,
    evidenceVerification: {
      UNVERIFIED: "Commit source not checked",
      VERIFIED: "Matches commit source",
      MISMATCH: "Differs from commit source",
      UNAVAILABLE: "Commit source unavailable",
    },
    evidenceVerificationHint: {
      UNVERIFIED:
        "The stored snippet has not been compared with this commit's source yet.",
      VERIFIED: "The stored snippet matched this commit's source.",
      MISMATCH:
        "The stored snippet differed from this commit's source. It says nothing about whether the fix worked.",
      UNAVAILABLE: "This commit's source could not be read, so no comparison.",
    },
    evidenceWorkingTree: "Not committed yet",
    evidenceWorkingTreeHint:
      "This code is not committed yet, so there is no commit source to compare against. The commit beside it is the base this work sits on.",
    evidenceViewBaseCommit: "View base commit",
  },

  reviewDetail: {
    target: "Target",
    targetType: "Type",
    branch: "Branch",
    commit: "Commit",
    pullRequest: "Pull Request",
    ranAt: "Ran",
    summary: "Summary",
    foundIssues: "Issues found",
    foundIssuesHint: (count: number) =>
      `${count} · status shown is current, not as of this review`,
    clean: "Nothing was found",
  },

  repositoryDetail: {
    disconnected: "Disconnected",
    reviews: "Reviews",
    openIssues: "Open Issues",
    recentReviews: "Recent Reviews",
    now: "Now",
    lastReview: "Last review",
    registered: "Added",
    noOpenIssues: "No open issues.",
    noReviews: "No reviews yet.",
    move: "Move project",
    moveDescription: (repositoryFullName: string) =>
      `${repositoryFullName} moves with every review and issue under it.`,
    moveTarget: "Move to",
    movePlaceholder: "Target project",
    moving: "Moving",
    moveAction: "Move",
    cancel: "Cancel",
  },

  projectSettings: {
    title: "Project Settings",
    name: "Name",
    slug: "slug",
    slugHint: "Changing it changes every URL of this project.",
    descriptionField: "Description",
    saving: "Saving",
    save: "Save",
    cancel: "Cancel",
    deleteTitle: "Delete project",
    deleteDialogTitle: (name: string) => `Delete ${name}`,
    deleteRescue: " To keep a repository, move it to another project first.",
    deleteEmpty: "This project is empty.",
    deleteImpact: (impact: {
      repositories: number;
      reviewSessions: number;
      reviewIssues: number;
      knowledgePages: number;
    }) =>
      `${impact.repositories} repositories · ${impact.reviewSessions} reviews · ` +
      `${impact.reviewIssues} issues · ${impact.knowledgePages} pages will be deleted with it.`,
    irreversible: "This cannot be undone.",
    confirmPrefix: "Type ",
    confirmSuffix: " to confirm",
    deleting: "Deleting",
    delete: "Delete",
  },

  wikiPage: {
    newTitle: "New page",
    editTitle: "Edit page",
    optional: "(optional)",
    slugHint: "Leave blank to derive it from the title",
    saving: "Saving",
    save: "Save",
    deleteConfirm: "Delete this page?",
    deleteDescription: (title: string) => `“${title}” will be deleted.`,
    deleteConsequence: "A deleted page cannot be restored.",
    deleting: "Deleting",
    delete: "Delete",
    cancel: "Cancel",
    noAuthor: "No author",
    edit: "Edit",
    /** 🔴 English puts the word first — the dictionary owns that order, not the screen. */
    updatedAt: { before: "Updated", after: "" },
    backToList: "All pages",
    emptyBody: "This page is empty.",
  },

  errorPage: {
    generic: "Something went wrong.",
    globalGeneric: "This page could not be loaded.",
    hint: "Please try again in a moment.",
    digestLabel: "Include this code when reporting the problem:",
    retry: "Try again",
  },

  validation: {
    invalidInput: "Some values are not valid.",
    required: "This field is required.",
    tooLong: (max: number) => `Must be ${max} characters or fewer.`,
    tooShort: (min: number) => `Must be at least ${min} characters.`,
    email: "Enter a valid email address.",
    rules: {
      unstorableText: "Contains characters that cannot be stored.",
      resolutionSummaryRequired:
        "A resolution summary is required to mark this resolved.",
      invitationToken: "This invitation link is not valid.",
      endLineBeforeStartLine: "The end line cannot be before the start line.",
      endLineWithoutStartLine:
        "Sending an end line also requires a start line.",
      reservedExternalRepositoryId:
        "externalRepositoryId cannot start with `fullname:`.",
      fullNameMismatch: "fullName must match owner/name.",
    },
  },

  /** 🔴 이름(`PROJECT_SLUG_TAKEN`)은 값이라 그대로다. 여기 있는 것은 보이는 글자뿐이다. */
  errors: {
    UNEXPECTED: "Something went wrong.",
    RESOURCE_NOT_FOUND: "Not found.",

    AGENT_UNAUTHORIZED: "Authentication is required.",
    AGENT_CAPABILITY_REQUIRED:
      "This Agent connection does not have the required capability.",
    AGENT_CONTEXT_REQUIRED:
      "A Repository or authorized Workspace selection is required.",
    AGENT_CREDENTIAL_NAME_INVALID:
      "That Agent connection name is not valid.",
    NOT_CONNECTED_OR_NOT_AUTHORIZED:
      "No connected Repository was found in an authorized Workspace.",
    REPOSITORY_CONTEXT_AMBIGUOUS: () =>
      "This Repository is connected to multiple authorized Workspaces. Select a Workspace for this Repository.",
    AGENT_BODY_NOT_JSON: "The request body is not valid JSON.",
    AGENT_BODY_TOO_LARGE: "The request body is too large.",
    AGENT_BODY_UNSTORABLE_TEXT:
      "The request body contains characters that cannot be stored.",
    AGENT_IDEMPOTENCY_KEY_TOO_LONG: "That Idempotency-Key is too long.",

    API_KEY_NAME_INVALID: "That API Key name is not valid.",

    PROJECT_SLUG_RESERVED: ({ slug }) =>
      `'${slug}' is used by a page address, so it cannot be a Project slug.`,
    PROJECT_SLUG_TAKEN: "A Project with that slug already exists.",
    PROJECT_NAME_TAKEN:
      "A Project with that name already exists. Choose a slug yourself.",
    PROJECT_NOT_FOUND: "Project not found.",
    MOVE_TARGET_PROJECT_NOT_FOUND: "The destination Project was not found.",
    REPOSITORY_NOT_FOUND: "Repository not found.",
    REPOSITORY_NOT_CONNECTED:
      "This Repository is not connected to a Project yet.",
    REPOSITORY_PROJECT_MISMATCH:
      "This Repository is connected to another Project. Use the move action.",
    REPOSITORY_IDENTITY_CONFLICT:
      "The same name is connected to a different GitHub Repository ID.",
    GITHUB_REPOSITORY_NOT_AUTHORIZED:
      "The GitHub App cannot access this Repository.",
    GITHUB_INSTALLATION_NOT_FOUND: "GitHub connection not found.",
    GITHUB_INSTALLATION_CONFLICT:
      "This GitHub installation is connected to another Workspace.",
    GITHUB_CALLBACK_INVALID:
      "This GitHub connection request is invalid or expired.",

    KNOWLEDGE_PAGE_SLUG_RESERVED: ({ slug }) =>
      `'${slug}' is used by a page address, so it cannot be a page slug.`,
    KNOWLEDGE_PAGE_SLUG_TAKEN: "A page with that slug already exists.",
    KNOWLEDGE_PAGE_NOT_FOUND: "Page not found.",

    INVITATION_UNUSABLE: "This invitation cannot be used.",
    INVITATION_NOT_CANCELABLE: "This invitation cannot be cancelled.",
    INVITATION_ALREADY_PENDING:
      "An invitation to this email is still valid. Send that link, or cancel it in the pending list before inviting again.",

    WORKSPACE_MEMBER_ALREADY: "Already a member of this Workspace.",
    WORKSPACE_MEMBER_NOT_FOUND: "Member not found.",
    WORKSPACE_NAME_REQUIRED: "Enter a Workspace name.",
    WORKSPACE_NAME_UNUSABLE:
      "No Workspace address could be made from that name. Try another one.",
    WORKSPACE_LAST_OWNER:
      "This is the last OWNER. Promote another member to OWNER first.",
    PERSONAL_WORKSPACE_ROLE_FIXED:
      "The owner of a Personal Workspace cannot change role.",
    WORKSPACE_SELF_REMOVE: "You cannot remove yourself.",
    PERSONAL_WORKSPACE_OWNER_FIXED:
      "The owner of a personal workspace cannot be removed.",
    WORKSPACE_NOT_FOUND: "Workspace not found.",
    WORKSPACE_OWNER_REQUIRED: "Workspace not found.",
    PERSONAL_WORKSPACE_UNDELETABLE: "A personal workspace cannot be deleted.",
    WORKSPACE_HAS_MEMBERS:
      "A workspace with other members cannot be deleted. Remove the members first.",

    ACCOUNT_NOT_FOUND: "Account not found.",
    ACCOUNT_WORKSPACES_CHANGED:
      "A Workspace was created while the deletion was being prepared. Try again.",
    ACCOUNT_LAST_OWNER:
      "You are the last OWNER of a Workspace that still has other members. Promote another member to OWNER and try again.",
    WORKSPACE_SLUG_RELEASE_FAILED:
      "The Workspace address could not be changed. Try again in a moment.",
  },

  notFound: {
    title: "This address does not exist.",
    back: "Back to dashboard",
  },

  metaTitle: {
    login: "Sign in",
    invite: "Invitation",
    dashboard: "Dashboard",
    projects: "Projects",
    members: "Members",
    settings: "Settings",
    wiki: "Wiki",
    wikiNew: "New page",
    wikiEdit: "Edit page",
    project: "Project",
    projectSettings: "Project Settings",
    reviews: "Reviews",
    review: "Review",
    issues: "Issues",
    issue: "Issue",
    repositories: "Repositories",
    repository: "Repository",
  },

  date: {
    today: "Today",
    days: (count: number) => `${count}d`,
    justNow: "Just now",
    minutesAgo: (count: number) => `${count}m ago`,
    hoursAgo: (count: number) => `${count}h ago`,
    yesterdayAt: (time: string) => `Yesterday ${time}`,
  },
};
