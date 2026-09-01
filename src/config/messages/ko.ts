import type {
 IssueActivityType,
 IssueCategory,
 IssueSeverity,
 IssueStatus,
 ReviewerType,
 ReviewTargetType,
 ScmProvider,
 WorkspaceRole,
} from "@/types/review";
import type { AppErrorMessages } from "@/lib/errors";
import type { ValidationRule } from "@/lib/validation/validation-rule";

/**
 * 한국어 문구. **이 파일이 사전의 정본 타입이다.**
 *
 * 🔴 **`as const` 를 붙이지 않는다.** 붙이면 값이 리터럴 타입이 되어 `en: Messages` 가
 * 같은 «문자열»까지 요구하게 된다 — 번역이 아예 불가능해진다.
 *
 * ## 🔴 「값」과 「이름표」를 가른다
 *
 * ```
 * 값(value) OPEN · HIGH · TRANSACTION API·DB·URL·TypeScript 가 쓰는 것. 손대지 않는다
 * 이름표(label) 미해결 · 높음 · 트랜잭션 사람이 보는 것. 화면 언어를 따른다
 * ```
 *
 * 둘은 `enums` 에서 **한 곳으로** 이어진다 — `Record<IssueStatus, string>` 이라
 * Domain 에 값이 하나 늘면 여기서 곧바로 typecheck 가 깨진다. 🔴 **화면마다 switch 로
 * 옮겨 적지 않는다**. 🔴 **번역된 낱말이 Select 의 `value` 나 URL Search
 * Param 으로 들어가지 않는다** — 그 자리는 언제나 값이고, 이 사전은 보이는 글자만 갖는다.
 *
 * 🔴 **값 그대로여야 하는 것도 있다** — `patternKey`(`N_PLUS_ONE`) · 파일 경로 ·
 * commit SHA · slug · 저장소 실제 이름. 열린 집합이거나 코드에서 그대로 옮겨 적는 값이다.
 *
 * 🔴 **고유명사와 기술 낱말은 남긴다** — `ReviewTrace` · `GitHub` · `Agent` · `API Key` ·
 * `MCP` · `Markdown` · `slug` · Endpoint 경로. 옮기면 문서·명령과 갈라진다.
 *
 * 값에 다른 값을 끼워 넣어야 하면 **함수**로 둔다. 형식 문자열 라이브러리를 들이지 않는다
 * — 지원 언어가 둘이고 복수형 규칙을 쓰는 자리가 없다.
 */
export const ko = {
 common: {
 /** Section 머리의 「더 보기」. */
 viewAll: "전체 보기",

 /**
 * 표 아래 이동 줄(`components/organisms/TablePagination.tsx`).
 *
 * 🔴 **목록마다 다시 적지 않는다.** 「전체 N건 중 x–y」처럼 문장으로 늘여 쓰던 것을
 * 걷어낸 자리다 — 총 건수는 숫자 하나면 되고, 지금 어디인지는 칠해진 쪽 번호가 말한다.
 */
 pagination: {
 total: (total: number) => `${total}건`,
 previous: "이전 페이지",
 next: "다음 페이지",
 /** 화면에는 숫자만 보인다. 이 낱말은 `aria-label` 로만 쓰인다. */
 pageSize: "쪽당 표시 개수",
 page: (page: number) => `${page}페이지`,
 navigation: "페이지 이동",
 },
 },

 /**
 * Domain 값의 **이름표**.
 *
 * 🔴 **값은 그대로 두고 보이는 글자만 바꾼다.** Select 의 `value` · URL Search Param ·
 * Server Action 에 실려 가는 것은 `OPEN` · `HIGH` 그대로다(`types/review.ts`).
 *
 * 🔴 **`Record<Enum, string>` 으로 둔다.** Domain 에 값이 하나 늘면 두 사전이 동시에
 * typecheck 로 깨진다 — 「화면에만 이름이 없는 값」이 조용히 생기지 않는다.
 */
 enums: {
 severity: {
 CRITICAL: "치명적",
 HIGH: "높음",
 MEDIUM: "보통",
 LOW: "낮음",
 INFO: "참고",
 } satisfies Record<IssueSeverity, string>,
 status: {
 OPEN: "미해결",
 IN_PROGRESS: "진행 중",
 RESOLVED: "해결됨",
 IGNORED: "무시함",
 /** 🔴 「해결됨」과 다른 말이다 — Agent 가 잘못 짚은 것이다. */
 FALSE_POSITIVE: "오탐",
 REOPENED: "재발생",
 } satisfies Record<IssueStatus, string>,
 /** 넓은 기술 영역. Tag·Pattern 과 다르다. */
 category: {
 ARCHITECTURE: "아키텍처",
 SECURITY: "보안",
 PERFORMANCE: "성능",
 DATABASE: "데이터베이스",
 TRANSACTION: "트랜잭션",
 CONCURRENCY: "동시성",
 API: "API",
 VALIDATION: "검증",
 EXCEPTION_HANDLING: "예외 처리",
 TESTING: "테스트",
 CLEAN_CODE: "코드 품질",
 RELIABILITY: "안정성",
 } satisfies Record<IssueCategory, string>,
 activityType: {
 DETECTED: "발견",
 FIX_ATTEMPTED: "수정 시도",
 REVIEWED_AGAIN: "재검토",
 RESOLVED: "해결",
 REOPENED: "재발생",
 IGNORED: "무시",
 COMMENT: "메모",
 } satisfies Record<IssueActivityType, string>,
 /** 🔴 Review 대상은 Pull Request 에 한정하지 않는다. */
 targetType: {
 PULL_REQUEST: "Pull Request",
 COMMIT: "커밋",
 BRANCH: "브랜치",
 REPOSITORY: "저장소",
 MANUAL: "수동",
 } satisfies Record<ReviewTargetType, string>,
 reviewerType: {
 AGENT: "Agent",
 HUMAN: "사람",
 SYSTEM: "시스템",
 } satisfies Record<ReviewerType, string>,
 /** 🔴 고유명사다. 표기만 바로잡는다. */
 provider: {
 GITHUB: "GitHub",
 } satisfies Record<ScmProvider, string>,
 role: {
 OWNER: "소유자",
 MEMBER: "멤버",
 } satisfies Record<WorkspaceRole, string>,
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
 projectHeading: "프로젝트",
 expand: "사이드바 펼치기",
 collapse: "사이드바 접기",
 workspaceLabel: "워크스페이스",
 personal: "개인",
 createWorkspace: "워크스페이스 만들기",
 noName: "이름 없음",
 signOut: "로그아웃",
 /**
 * 메뉴 이름.
 *
 * 🔴 **키는 `config/navigation.ts` 의 것을 그대로 쓴다.** 그래야 메뉴를 하나 더할 때
 * 여기 문구가 빠지면 typecheck 가 깨진다 — 「사이드바에는 있는데 이름이 없는」 항목이
 * 조용히 생기지 않는다.
 *
 * 🔴 **Section 이름은 «주소의 조각»이 아니라 사람이 읽는 이름표다.** 주소는
 * `config/navigation.ts` 의 `section` 이 갖고 있어 여기서 옮겨도 URL 은 그대로다 —
 * 한국어 화면의 사이드바가 통째로 영어로 남아 있을 이유가 없다.
 */
 workspace: {
 DASHBOARD: "대시보드",
 PROJECTS: "프로젝트",
 WIKI: "위키",
 MEMBERS: "멤버",
 SETTINGS: "설정",
 },
 project: {
 OVERVIEW: "개요",
 REVIEWS: "리뷰",
 ISSUES: "이슈",
 WIKI: "위키",
 REPOSITORIES: "저장소",
 SETTINGS: "설정",
 },
 },

 login: {
 /** 🔴 실패 사유를 나누어 보여 주지 않는다. */
 error: "로그인하지 못했습니다. 잠시 뒤 다시 시도하세요.",
 continueWithGithub: "GitHub으로 로그인",

 /**
 * 왼쪽 소개 단.
 *
 * 🔴 **기능을 명사로 나열하지 않는다.** 「체계적인 리뷰 관리」 같은 말은 어떤 Issue
 * Tracker 에나 붙어, 이 제품이 «무엇을 남기는지» 를 말하지 못한다. 세 줄이
 * **발견 → 근거 → 판단** 이라는 실제 흐름을 그대로 따라가게 썼다.
 *
 * 🔴 **Brand 색으로 문장 절반을 칠하지 않는다.** 강조는 뒷줄 한 덩어리까지다.
 */
 headlineLead: "코드 리뷰를",
 headlineAccent: "엔지니어링의 기억으로.",
 headlineTail: "",
 subhead:
 "Coding Agent가 발견한 문제와 해결의 근거를 코드와 함께 보존해 다음 리뷰에서도 이전의 판단을 이어갈 수 있게 합니다.",
 features: [
 {
 title: "문제부터 해결까지",
 body: "발견부터 수정, 재검토, 해결까지 하나의 이력으로 이어집니다.",
 },
 {
 title: "코드로 남는 근거",
 body: "커밋·파일·줄 범위를 연결하고 실제 GitHub 코드와 대조합니다.",
 },
 {
 title: "해결 뒤에도 남는 판단",
 body: "선택한 방법과 대안 trade-off를 해결 이력과 함께 보존합니다.",
 },
 ],

 /**
 * 왼쪽 단 맨 아래 띠(`LoginAgentSupport`)의 왼쪽 label.
 *
 * 🔴 **여기 있는 낱말은 이것 하나뿐이다.** `Claude Code` · `Codex` · `MCP` 는
 * 제품·프로토콜 이름이라 양쪽 언어에서 그대로다(이 파일 머리말) — 컴포넌트에 둔다.
 *
 * 🔴 **연결 «구조»를 설명하지 않는다.** 로그인 화면이 답할 것은 「쓰던 Agent 가
 * 그대로 붙는가」까지다 — 어떤 경로로 닿는지는 로그인 뒤 Settings 와
 * `docs/agent-integration.md` 가 안내한다.
 *
 * 🔴 **짧게 유지한다.** 이 띠는 왼쪽에 label, 오른쪽에 Agent 이름을 두는 한 줄이라
 * label 이 길어지면 1440 에서 두 줄로 접혀 오른쪽 카드의 머리 띠와 결이 갈린다 —
 * 실제로 「…와 그대로 연결됩니다」로 적었을 때 접혔다.
 *
 * 🔴 **「연결」이 아니라 「연동」이다.** 「사용하는 Coding Agent와 연결」은 ReviewTrace 가
 * Agent 에 «접속»하거나 연결을 «수행»한다는 뜻으로 읽힌다 — 실제로는 사용자가 자기
 * Agent 에 MCP Server 를 등록하는 것이고, 우리가 하는 일은 그것을 받아 주는 것까지다.
 */
 agentSupport: "Coding Agent 연동",

 /**
 * 오른쪽 미리보기(`LoginShowcase`) 안에서 **문장인 것 둘**.
 *
 * 🔴 **나머지는 번역하지 않는다.** `RESOLVED` · `HIGH` · `TRANSACTION` · `COMMIT` ·
 * `codex` · 파일 경로 · commit SHA 는 Agent 가 보내고 API 가 계약으로 쓰는 값이라
 * 양쪽 언어에서 그대로다(이 파일 머리말). `Issue` · `Code Evidence` · `Decision` ·
 * `Verified` 도 이 제품의 Domain 낱말이라 컴포넌트에 그대로 둔다.
 */
 showcaseIssue: "트랜잭션 밖에서 실행되는 상태 변경",
 /**
 * 🔴 **상태값이 아니라 «왜 그 수정을 골랐는가»다**(`issue_activities.decision_reason`).
 * 「고쳤다」는 어느 도구에나 남는다 — 남지 않는 것이 이 한 줄이고, 그것이 다음
 * Review 에서 다시 쓰이는 Knowledge 다.
 */
 showcaseDecision:
 "Resolution과 Activity 기록을 동일 트랜잭션으로 묶어 부분 저장 상태가 남지 않도록 했습니다.",

 /**
 * 🔴 **Login Card 에는 제품 이름과 버튼뿐이다.** 설명 한 줄을 두었더니 왼쪽
 * Headline 과 같은 말을 두 번 하면서도 아무것도 더 말하지 못했다 — 빈자리를
 * 채우려고 slogan·계정 안내·OAuth 설명을 다시 넣지 않는다.
 */

 /**
 * 푸터. `© 2026 ReviewTrace · GitHub · License` 셋뿐이다.
 *
 * 🔴 **`All rights reserved.` 를 적지 않는다.** 이 저장소는 Apache-2.0 이라
 * 「모든 권리를 유보한다」는 문구가 실제 라이선스와 반대로 읽힌다 — 링크가
 * 가리키는 `LICENSE` 파일이 정본이고, 푸터는 그 자리를 알려 주기만 한다.
 *
 * 🔴 **`GitHub` 은 옮기지 않는다**(이 파일 머리말 — 고유명사).
 */
 license: "라이선스",
 docs: "Docs",
 },

 workspaceDialog: {
 title: "워크스페이스 만들기",
 /** 🔴 남긴다 — 「무엇의 경계인가」는 만들기 전에 알아야 할 것이다. */
 description: "멤버와 API Key를 나누는 경계입니다.",
 name: "이름",
 submit: "만들기",
 submitting: "만드는 중",
 },

 projectDialog: {
 trigger: "프로젝트 만들기",
 title: "프로젝트 만들기",
 /** 🔴 남긴다 — 저장소가 어디에 붙는지를 모르면 만들 이유를 알 수 없다. */
 description: "저장소는 프로젝트 아래에 붙습니다.",
 name: "이름",
 slug: "slug",
 optional: "(선택)",
 slugPlaceholder: "비워 두면 이름에서 만듭니다",
 slugHint: (workspaceSlug: string) =>
 `주소에 쓰입니다 · /w/${workspaceSlug}/p/{slug}`,
 descriptionField: "설명",
 submit: "만들기",
 submitting: "만드는 중",
 },

 /**
 * 🔴 **Section 이름을 풀어쓴 설명을 두지 않는다**.
 *
 * 「반복되는 문제」(Frequent Patterns 아래) · 「Review 실행과 해결 기록」(Recent Activity
 * 아래) 처럼 제목을 한 번 더 말할 뿐인 줄을 걷어냈다. **남긴 것은 판단에 필요한 것뿐**이다 —
 * 지표의 관측 구간(`hint*`) · 되돌릴 수 없다는 경고.
 *
 * 🔴 **Empty State 는 «상태»만 적는다.** 「무엇을 만드세요」·「Agent 가 …를 보내면 여기에
 * 쌓입니다」처럼 사용법을 설명하던 줄은 전부 걷어냈다 — 다음 행동은 화면의 Action 이
 * 말하고, 비어 있다는 사실은 한 줄이면 된다.
 */
 workspaceDashboard: {
 kpiReviews: "리뷰",
 kpiIssuesFound: "발견된 이슈",
 kpiResolved: "해결됨",
 kpiOpen: "미해결",
 /** 🔴 남긴다 — 「언제부터의 숫자인가」가 없으면 값의 뜻이 달라진다. */
 hintLast30Days: "최근 30일",
 hintOpenNow: "현재",
 projects: {
 title: "프로젝트",
 empty: "프로젝트가 없습니다",
 colProject: "프로젝트",
 colRepositories: "저장소",
 colReviews: "리뷰",
 colOpen: "미해결",
 colLastActivity: "최근 활동",
 },
 needsAttention: {
 title: "확인이 필요한 이슈",
 empty: "미해결 이슈가 없습니다",
 colSeverity: "심각도",
 colIssue: "이슈",
 colProject: "프로젝트",
 colAge: "경과",
 },
 patterns: {
 title: "반복 패턴",
 empty: "패턴이 없습니다",
 resolved: (count: number) => `해결 ${count}`,
 },
 activity: {
 title: "최근 활동",
 empty: "활동이 없습니다",
 /** 행위자 이름은 굵게 따로 그린다 — 여기 담기는 것은 그 뒤에 붙는 말이다. */
 reviewSuffix: (repository: string, issueCount: number) =>
 `가 ${repository} 검토 · 이슈 ${issueCount}건`,
 resolutionSuffix: (repository: string) => ` 해결 · ${repository}`,
 },
 },

 projectDashboard: {
 kpiReviews: "리뷰",
 kpiIssues: "이슈",
 kpiOpen: "미해결",
 kpiResolutionRate: "해결률",
 hintLast30Days: "최근 30일",
 hintNow: "현재",
 hintFoundLast30Days: "최근 30일 발견분",
 openIssues: {
 title: "미해결 이슈",
 empty: "미해결 이슈가 없습니다.",
 colSeverity: "심각도",
 colIssue: "이슈",
 colLocation: "저장소 · 위치",
 colAge: "경과",
 },
 patterns: {
 title: "반복 패턴",
 empty: "패턴이 없습니다.",
 colPattern: "패턴",
 colCategory: "분류",
 colOccurrences: "발생",
 colResolved: "해결",
 colLast: "최근",
 },
 recentReviews: {
 title: "최근 리뷰",
 empty: "리뷰가 없습니다.",
 colReviewer: "리뷰어",
 colRepository: "저장소",
 colTarget: "대상",
 colIssues: "이슈",
 colDate: "날짜",
 },
 repositories: {
 title: "저장소",
 empty: "저장소가 없습니다.",
 colRepository: "저장소",
 colReviews: "리뷰",
 colOpen: "미해결",
 colLastReview: "최근 리뷰",
 },
 wiki: {
 title: "위키",
 empty: "문서가 없습니다.",
 },
 resolutions: {
 title: "최근 해결",
 empty: "해결 기록이 없습니다.",
 },
 },

 projects: {
 title: "프로젝트",
 empty: "프로젝트가 없습니다",
 colProject: "프로젝트",
 colSlug: "slug",
 colRepositories: "저장소",
 colReviews: "리뷰",
 colOpenIssues: "미해결 이슈",
 colLastActivity: "최근 활동",
 },

 issues: {
 title: "이슈",
 filter: {
 search: "검색",
 searchPlaceholder: "제목 · 파일 · 패턴",
 severity: "심각도",
 category: "분류",
 status: "상태",
 allSeverity: "전체 심각도",
 allCategory: "전체 분류",
 allStatus: "전체 상태",
 submit: "조회",
 submitting: "조회 중",
 reset: "초기화",
 },
 empty: "조건에 맞는 이슈가 없습니다.",
 colSeverity: "심각도",
 colTitle: "제목",
 colCategory: "분류",
 colLocation: "위치",
 colStatus: "상태",
 colDetected: "발견",
 },

 reviews: {
 title: "리뷰",
 empty: "리뷰가 없습니다",
 colReviewer: "리뷰어",
 colRepository: "저장소",
 colTarget: "대상",
 colIssues: "이슈",
 colDate: "날짜",
 },

 repositories: {
 title: "저장소",
 empty: "저장소가 없습니다",
 colRepository: "저장소",
 colDefaultBranch: "기본 브랜치",
 colReviews: "리뷰",
 colOpenIssues: "미해결 이슈",
 colLastReview: "최근 리뷰",
 },

 wiki: {
 workspaceHeading: "워크스페이스 위키",
 /**
 * 🔴 **이 둘은 남긴다.** 「어느 위키인가」가 아니라 **「여기에 무엇을 적는가」**를
 * 말한다 — 제목만으로는 워크스페이스 위키와 프로젝트 위키의 경계를 알 수 없다.
 */
 workspaceDescription: "모든 프로젝트에 공통으로 적용하는 규칙과 기록",
 projectHeading: "프로젝트 위키",
 projectDescription: (projectName: string) =>
 `${projectName} 프로젝트의 규칙과 기록`,
 create: "문서 작성",
 empty: "문서가 없습니다",
 colTitle: "제목",
 colSlug: "slug",
 colAuthor: "작성자",
 colUpdated: "수정",

 /** 문서를 «쓰는» 화면. 목록·상세와 낱말이 겹치지 않아 따로 둔다. */
 form: {
 newTitle: "새 문서",
 editTitle: "문서 수정",
 backToList: "위키",
 save: "저장",
 saving: "저장 중",
 cancel: "취소",
 /**
 * 🔴 **이 둘은 label 이자 placeholder 다.** 제목 칸과 본문 칸은 label 을 화면에서
 * 감춘 자리라(`KnowledgePageForm`) placeholder 가 지워지면 「무엇을 적는 칸인지」를
 * 말해 주는 것이 아무것도 남지 않는다 — 그래서 «칸 이름»만 남기고 사용법 설명
 * (「코드는 ```로 감싸세요」)은 걷어냈다. 그 일은 Toolbar 가 한다.
 */
 titleLabel: "문서 제목",
 slugLabel: "Slug (선택)",
 slugPlaceholder: "transaction-boundary",
 slugHint: "비워 두면 제목에서 만듭니다",
 contentLabel: "본문 (Markdown)",
 editor: {
 write: "작성",
 preview: "미리 보기",
 previewEmpty: "미리 볼 내용이 없습니다.",
 heading: "제목",
 bold: "굵게",
 italic: "기울임",
 inlineCode: "인라인 코드",
 codeBlock: "코드 블록",
 link: "링크",
 bulletList: "글머리 목록",
 numberedList: "번호 목록",
 },
 },
 },

 settings: {
 title: "설정",
 workspaceSection: "워크스페이스",
 workspaceName: "이름",
 workspaceKind: "종류",
 kindPersonal: "개인 워크스페이스",
 kindTeam: "팀 워크스페이스",
 myRole: "내 역할",
 scale: "규모",
 statProjects: "프로젝트",
 statMembers: "멤버",
 apiKeysSection: "API Key",
 integrationSection: "Agent 연동",
 accountSection: "계정",
 dangerSection: "워크스페이스 삭제",
 },

 /**
 * Workspace 삭제. 🔴 「무엇이 사라지는가」와 「왜 못 지우는가」를 말하는 낱말들이다.
 *
 * 🔴 **Personal Workspace 의 문구는 여기 없다.** 그 경우 삭제 UI 자체가 그려지지 않는다 —
 * 지울 수 없는 버튼을 보여 주고 이유를 설명하는 것보다, 없는 편이 정확하다.
 */
 workspaceDelete: {
 intro:
 "워크스페이스를 삭제하면 그 안의 모든 리뷰 기록이 함께 사라지며 복구할 수 없습니다.",
 losses: "삭제되는 데이터",
 statProjects: "프로젝트",
 statRepositories: "저장소",
 statReviews: "리뷰",
 statIssues: "이슈",
 statPages: "문서",
 statKeys: "API Key",
 statInvitations: "초대",
 statTags: "태그",
 blockedTitle: "먼저 해결해야 합니다",
 /** 🔴 정책이 정한 문구 그대로다. 오류 사전의 `WORKSPACE_HAS_MEMBERS` 와 같은 문장이다. */
 blockedMembers:
 "다른 멤버가 있는 Workspace는 삭제할 수 없습니다. 먼저 멤버를 내보내세요.",
 delete: "워크스페이스 삭제",
 cancel: "취소",
 dialogTitle: "워크스페이스를 삭제할까요?",
 dialogBody:
 "이 워크스페이스의 프로젝트·리뷰·이슈·문서·API Key가 모두 사라집니다. 되돌릴 수 없습니다.",
 confirmPrefix: "확인하려면 ",
 confirmSuffix: "를 그대로 입력하세요.",
 },

 /** 계정 삭제. 🔴 「무엇이 사라지고 무엇이 남는가」를 말하는 낱말들이다. */
 account: {
 intro:
 "계정을 삭제하면 로그인 정보와 모든 세션이 삭제되며 복구할 수 없습니다.",
 willDelete: "함께 삭제",
 losses: "삭제되는 데이터",
 statProjects: "프로젝트",
 statIssues: "이슈",
 statPages: "문서",
 statKeys: "API Key",
 blockedTitle: "먼저 해결해야 합니다",
 blockedHint:
 "다른 멤버가 있는데 OWNER가 나뿐인 워크스페이스입니다. 멤버 화면에서 다른 멤버를 OWNER로 올린 뒤 다시 시도하세요.",
 delete: "계정 삭제",
 cancel: "취소",
 dialogTitle: "계정을 삭제할까요?",
 dialogBody:
 "혼자 쓰던 워크스페이스는 그 안의 리뷰 기록과 함께 사라집니다. 되돌릴 수 없습니다.",
 confirmPrefix: "확인하려면 ",
 confirmSuffix: "를 그대로 입력하세요.",
 },

 apiKeys: {
 /**
 * 🔴 **이름표가 화면에 없는 칸이라 placeholder 가 그 자리를 대신한다**(`ApiKeyPanel`).
 * 예시(`예: codex-ci`)를 두었지만 이름 짓기에 규칙이 있는 칸이 아니라 아무것도 돕지
 * 못했다 — 칸 이름만 남긴다.
 */
 nameLabel: "Key 이름",
 issue: "발급",
 empty: "발급된 Key가 없습니다.",
 expiresAt: "만료",
 /** 만료 선택지. 🔴 값(`30`·`NEVER`)은 Schema 의 것이고 여기 있는 것은 이름표뿐이다. */
 expiry30: "30일",
 expiry90: "90일",
 expiry365: "1년",
 expiryNever: "만료 없음",
 columnName: "이름",
 columnPrefix: "Prefix",
 columnLastUsed: "마지막 사용",
 columnExpires: "만료",
 columnStatus: "상태",
 never: "없음",
 revoked: "폐기됨",
 expired: "만료됨",
 active: "사용 중",
 revoking: "폐기 중",
 revoke: "폐기",
 cancel: "취소",
 /** 🔴 「이」를 붙이지 않는다 — 어느 Key 인지는 바로 아래 이름이 말한다. */
 revokeConfirmTitle: "API Key를 폐기할까요?",
 /**
 * 🔴 **「복구할 수 없다」고 적지 않는다.** 폐기는 행을 지우는 것이 아니라 `revokedAt`
 * 을 찍는 것이라 「이 키가 언제까지 무엇을 했는가」는 그대로 남는다 —
 * 사라지는 것은 **인증 자격**이다. 실제로 일어나는 일만 적는다.
 *
 * 🔴 **두 사실을 한 문장으로 잇지 않는다.** 잃는 것(인증)과 남는 것(기록)은 성격이
 * 다른 사실이라, 이어 붙이면 뒤엣것이 앞엣것의 단서처럼 읽힌다. 줄을 나눠 둔다.
 */
 revokeConfirmAuthLoss: "폐기하면 이 Key로 더 이상 인증할 수 없습니다.",
 revokeConfirmRecordKept: "기존 기록은 그대로 유지됩니다.",
 copy: "복사",
 copied: "복사됨",
 close: "닫기",
 issuedTitle: "API Key 발급 완료",
 /** 🔴 남긴다 — 다시 볼 수 없다는 사실을 이 화면에서 놓치면 키를 잃는다. */
 issuedWarning:
 "전체 API Key는 다시 확인할 수 없습니다. 지금 복사해 안전한 곳에 보관해 주세요.",
 },

 integration: {
 step1: "1. 등록",
 step2: "2. 확인",
 copyCommand: (step: string) => `${step} 명령 복사`,
 /** 🔴 남긴다 — 모르면 실제로 막히거나 키가 새는 자리다. 장식이 아니다. */
 claudeNote:
 "설정은 user 범위에 저장됩니다. 저장소의.mcp.json은 사용하지 마세요.",
 codexNote:
 "직접 설정 파일을 수정하지 말고 위 명령으로 등록하세요. " +
 "쓰기 작업은 실행 전 승인이 필요합니다.",
 /**
 * 🔴 앞뒤 공백까지 문구의 일부다 — 화면은 `<your-api-key>` 와 `.env` 를
 * 코드로 그리고 그 사이를 이 문자열로 잇는다. 언어마다 붙는 자리가 다르다.
 */
 keyHint: "에 위에서 발급한 키를 입력하세요. API Key는 저장소의 ",
 keyHintTail: "에 저장하지 마세요.",
 },

 members: {
 title: "멤버",
 columnName: "이름",
 columnRole: "역할",
 noName: "이름 없음",
 /** 🔴 남긴다 — 「왜 이 사람만 바꿀 수 없는가」를 말한다. */
 personalOwner: "개인 워크스페이스의 주인입니다",
 invite: "초대",
 pending: "수락 대기",
 noPending: "대기 중인 초대가 없습니다.",
 columnEmail: "이메일",
 columnExpires: "만료",
 inviteEmailLabel: "초대할 이메일",
 inviteLink: "초대 링크",
 /** 🔴 남긴다 — 링크 원문은 서버에 없어 이 화면을 떠나면 사라진다. */
 inviteLinkWarning: "지금 복사하세요. 이 링크는 다시 볼 수 없습니다.",
 roleLabel: "역할",
 /**
 * 🔴 **되묻는 창의 「나가는 길」과 낱말이 겹치지 않게 한다.** 둘 다 「취소」면
 * `[취소] [취소]` 가 나란히 서서 어느 쪽이 안전한 길인지 알 수 없다.
 */
 revoke: "초대 취소",
 cancel: "닫기",
 revokeConfirmTitle: "이 초대를 취소할까요?",
 /**
 * 🔴 **「복구할 수 없다」고 적지 않는다.** 취소는 행을 지우는 것이 아니라 `revoked_at`
 * 을 찍는 것이라 기록은 남고, **같은 주소로 다시 초대할 수 있다.**
 * 사라지는 것은 이미 나간 링크의 자격뿐이다 — 실제로 일어나는 일만 적는다.
 */
 revokeConfirmDescription:
 "이미 보낸 링크는 더 이상 수락할 수 없습니다. 같은 이메일로 다시 초대할 수 있습니다.",
 /** 🔴 「삭제」가 아니다 — 사라지는 것은 사람이 아니라 이 Workspace 의 소속뿐이다. */
 remove: "내보내기",
 removeConfirmTitle: "이 멤버를 내보낼까요?",
 /**
  * 🔴 **실제로 일어나는 일만 적는다.** 계정도, 그 사람이 다른 Workspace 에 갖고 있는
  * 소속도, 그가 남긴 기록도 그대로다 — 사라지는 것은 이 Workspace 에 대한 접근 권한뿐이고
  * 다시 초대할 수 있다.
  */
 removeConfirmDescription:
 "이 워크스페이스에 더 이상 접근할 수 없습니다. 계정과 남긴 기록은 그대로이고, 다시 초대할 수 있습니다.",
 },

 invite: {
 invalidTitle: "사용할 수 없는 초대",
 invalidBody:
 "링크가 만료됐거나 이미 사용됐습니다. 초대한 사람에게 다시 요청하세요.",
 title: (workspaceName: string) => `${workspaceName} 초대`,
 body: (email: string) =>
 `${email}로 초대받았습니다. 수락하면 이 워크스페이스의 멤버가 됩니다.`,
 signInFirst: "먼저 GitHub으로 로그인하세요. 로그인하면 이 화면으로 돌아옵니다.",
 accept: "초대 수락",
 },

 issueDetail: {
 description: "설명",
 rootCause: "근본 원인",
 failurePath: "실패·공격 경로",
 suggestion: "제안",
 resolution: "해결",
 history: "이력",
 noHistory: "기록이 없습니다",
 status: "상태",
 location: "위치",
 identity: "식별",
 tags: "태그",
 source: "출처",
 detected: "발견",
 resolvedAt: "해결",
 firstReview: "처음 발견한 리뷰",
 lastChanged: "마지막 변경",
 changeStatus: "상태 변경",
 changing: "변경 중",
 resolutionSummary: "해결 요약",
 editResolutionSummary: "요약 수정",
 cancelResolutionSummary: "수정 취소",
 saveResolutionSummary: "요약 저장",
 emptyResolutionSummary: "해결 요약이 없습니다.",
 optional: "(선택)",
 activity: "기록",
 activityType: "기록 종류",
 commit: "커밋",
 commitSha: "커밋 SHA",
 activityDescription: "내용",
 recording: "남기는 중",
 record: "기록 남기기",
 decision: "판단 기록",
 solution: "해결책",
 decisionReason: "선택 이유",
 alternatives: "검토한 대안",
 tradeOff: "트레이드오프",
 verification: "검증",
 regressionTest: "회귀 테스트",
 residualRisk: "남은 위험",
 codeEvidence: "코드 근거",
 before: "문제 코드",
 after: "수정 코드",
 viewCode: "GitHub에서 보기",
 noSnapshot: "저장된 코드 스냅샷이 없습니다.",
 displayFormatted: "화면용 포맷",
 relativeLines: "상대 줄",
 showAllEvidenceLines: (count: number) => `전체 ${count}줄 보기`,
 evidenceVerification: {
 UNVERIFIED: "코드 확인 전",
 VERIFIED: "코드 일치",
 MISMATCH: "코드 불일치",
 UNAVAILABLE: "소스 확인 불가",
 },
 },

 reviewDetail: {
 target: "대상",
 targetType: "종류",
 branch: "브랜치",
 commit: "커밋",
 pullRequest: "Pull Request",
 ranAt: "실행",
 summary: "요약",
 foundIssues: "발견한 이슈",
 /** 🔴 남긴다 — 「이 Review 당시」가 아니라 «지금» 상태라는 사실은 오해하기 쉽다. */
 foundIssuesHint: (count: number) => `${count}건 · 상태는 현재 값`,
 clean: "문제를 찾지 못했습니다",
 },

 repositoryDetail: {
 disconnected: "연결 해제됨",
 reviews: "리뷰",
 openIssues: "미해결 이슈",
 recentReviews: "최근 리뷰",
 now: "현재",
 lastReview: "최근 리뷰",
 registered: "등록",
 noOpenIssues: "미해결 이슈가 없습니다.",
 noReviews: "리뷰가 없습니다.",
 move: "프로젝트 이동",
 /** 🔴 남긴다 — 무엇이 함께 따라가는지 모르고 옮기게 두지 않는다. */
 moveDescription: (repositoryFullName: string) =>
 `${repositoryFullName}과 그 아래 리뷰·이슈가 함께 옮겨집니다.`,
 moveTarget: "옮길 프로젝트",
 movePlaceholder: "옮길 프로젝트",
 moving: "옮기는 중",
 moveAction: "옮기기",
 cancel: "취소",
 },

 projectSettings: {
 title: "프로젝트 설정",
 name: "이름",
 slug: "slug",
 /** 🔴 남긴다 — slug 를 바꾸면 이 Project 의 모든 주소가 바뀐다. */
 slugHint: "바꾸면 이 프로젝트의 주소가 모두 바뀝니다.",
 descriptionField: "설명",
 saving: "저장 중",
 save: "저장",
 cancel: "취소",
 deleteTitle: "프로젝트 삭제",
 deleteDialogTitle: (name: string) => `${name} 을(를) 삭제합니다`,
 /** 🔴 남긴다 — 되돌릴 수 없는 작업의 경고와 그 영향 건수. */
 deleteRescue: " 저장소를 살리려면 먼저 다른 프로젝트로 옮기세요.",
 deleteEmpty: "이 프로젝트에는 아직 아무것도 없습니다.",
 deleteImpact: (impact: {
 repositories: number;
 reviewSessions: number;
 reviewIssues: number;
 knowledgePages: number;
 }) =>
 `저장소 ${impact.repositories} · 리뷰 ${impact.reviewSessions} · ` +
 `이슈 ${impact.reviewIssues} · 문서 ${impact.knowledgePages}이 함께 지워집니다.`,
 irreversible: "되돌릴 수 없습니다.",
 confirmPrefix: "확인을 위해 ",
 confirmSuffix: "을(를) 입력하세요",
 deleting: "삭제 중",
 delete: "삭제",
 },

 /**
 * Wiki 문서를 «읽는» 화면의 낱말. 쓰는 화면은 `wiki.form` 이 갖는다.
 *
 * 🔴 **삭제 dialog 는 두 줄이다** — 「무엇을 지우는가」(`deleteDescription`)와
 * 「그래서 어떻게 되는가」(`deleteConsequence`)를 한 문단으로 잇지 않는다
 * (`components/molecules/ConfirmDialog.tsx`).
 *
 * 🔴 **「복구할 수 없다」는 사실이라서 적는다.** `deleteKnowledgePage` 는 행을 그대로
 * `DELETE` 한다 — soft delete 인 API Key 폐기·초대 취소와 다르다.
 */
 wikiPage: {
 newTitle: "새 문서",
 editTitle: "문서 수정",
 optional: "(선택)",
 slugHint: "비워 두면 제목에서 만듭니다",
 saving: "저장 중",
 save: "저장",
 deleteConfirm: "이 문서를 삭제할까요?",
 deleteDescription: (title: string) => `‘${title}’ 을(를) 지웁니다.`,
 deleteConsequence: "삭제한 문서는 복구할 수 없습니다.",
 deleting: "삭제 중",
 delete: "삭제",
 cancel: "취소",
 noAuthor: "작성자 없음",
 edit: "수정",
 /** 🔴 날짜와 낱말의 «순서»가 언어를 탄다 — 화면에서 이어 붙이지 않는다. */
 updatedAt: (date: string) => `${date} 수정`,
 backToList: "목록",
 emptyBody: "본문이 비어 있습니다.",
 },

 /**
 * Error Boundary 의 낱말.
 *
 * 🔴 **두 자리의 사정이 다르다.** `app/error.tsx` 는 Root Layout **안**이라 서버가 읽은
 * 언어를 Context 로 받고(`lib/ui/locale-context.tsx`), `app/global-error.tsx` 는 Layout
 * 자체를 **대신하므로** Context 가 없다 — 거기서는 브라우저가 쿠키를 직접 읽는다.
 * 문구는 그래도 여기 한 곳이다.
 */
 errorPage: {
 generic: "오류가 발생했습니다.",
 /** Root Layout 까지 깨진 마지막 자리. 「무엇이」 안 됐는지가 다르다. */
 globalGeneric: "화면을 불러오지 못했습니다.",
 hint: "잠시 후 다시 시도해 주세요.",
 /** 🔴 `digest` 는 서버 Log 와 짝이다. Stack Trace 를 대신 보여 주지 않는다. */
 digestLabel: "문의 시 이 코드를 알려 주세요:",
 retry: "다시 시도",
 },

 /**
 * 입력 검증의 낱말.
 *
 * 🔴 **Schema 는 이 사전을 알지 못한다.** Schema 가 갖는 것은 규칙(`min(1)`)과, 우리
 * 고유 규칙이면 그 **이름**(`params.rule`)뿐이고, 문구는 여기 있다 —
 * `lib/validation/zod-error-map.ts` 가 둘을 잇는다.
 *
 * 🔴 **Zod 가 이미 아는 일반 검증을 여기 베끼지 않는다.** 여기 있는 것은 화면 폼에
 * 실제로 뜨는 몇 가지뿐이고, 나머지는 `z.locales.ko()` 로 떨어진다.
 *
 * 🔴 **필드 이름을 문구에 넣지 않는다.** 오류는 그 칸 바로 아래에 `aria-describedby` 로
 * 묶여 그려지므로 「제목은」을 다시 적을 필요가 없고, 적으려면 Schema 가 화면의 이름표를
 * 알아야 하거나 조사(은/는·을/를)를 추측해야 한다 — 둘 다 하지 않는다.
 */
 validation: {
 /** Server Action 이 입력을 거절했을 때의 한 줄. */
 invalidInput: "입력값이 올바르지 않습니다.",
 required: "필수 입력입니다.",
 /** 🔴 길이를 지우지 않는다 — 「너무 깁니다」가 아니라 「200자」다. */
 tooLong: (max: number) => `${max}자를 넘을 수 없습니다.`,
 tooShort: (min: number) => `${min}자 이상 입력하세요.`,
 email: "이메일 형식이 아닙니다.",
 /** ReviewTrace 고유 규칙. 이름은 `lib/validation/zod-error-map.ts` 가 정본이다. */
 rules: {
 unstorableText: "저장할 수 없는 문자가 들어 있습니다.",
 resolutionSummaryRequired: "해결됨으로 바꾸려면 해결 요약이 필요합니다.",
 invitationToken: "초대 링크가 올바르지 않습니다.",
 endLineBeforeStartLine: "끝 줄 번호는 시작 줄 번호보다 작을 수 없습니다.",
 endLineWithoutStartLine: "끝 줄 번호를 보내려면 시작 줄 번호도 함께 보내야 합니다.",
 reservedExternalRepositoryId:
 "externalRepositoryId는 `fullname:`으로 시작할 수 없습니다.",
 fullNameMismatch: "fullName은 owner/name과 같아야 합니다.",
 } satisfies Record<ValidationRule, string>,
 },

 /**
 * Application 이 던진 오류의 낱말.
 *
 * 🔴 **Service 는 이 사전을 알지 못한다.** Service 가 갖는 것은 「무엇이 잘못됐는가」
 * (`AppError` 의 `reason`)뿐이고, 문구는 여기 있다 — `lib/format/app-error.ts` 가 둘을
 * 잇는다. Zod 오류를 `lib/validation/zod-error-map.ts` 로 옮긴 것과 같은 구조다.
 *
 * 🔴 **`satisfies AppErrorMessages` 가 빠짐을 컴파일 시점에 잡는다.** 오류가 하나 늘면
 * 두 사전이 동시에 깨진다 — 「code 는 있는데 번역이 없다」가 조용히 지나가지 않는다.
 *
 * 🔴 **값이 들어가는 문장은 함수다.** Service 가 문자열을 이어 붙이면 그 문장이 한
 * 언어에 묶인다 — Service 가 넘기는 것은 `slug` 같은 **값**뿐이다.
 *
 * 🔴 **Agent API 는 이 사전을 쓰지 않는다.** 그쪽 문구는 화면 언어를 따르지 않는 고정
 * 문구다(`lib/errors.ts`) — 기계가 읽는 계약이 쿠키에 따라 흔들리면 안 된다.
 */
 errors: {
 /** 알 수 없는 오류의 마지막 한 줄. 원인은 서버 Log 에만 남는다. */
 UNEXPECTED: "요청을 처리하지 못했습니다.",
 RESOURCE_NOT_FOUND: "대상을 찾을 수 없습니다.",

 /** 🔴 아래 넷은 Agent 만 마주친다. 화면에는 뜨지 않지만 자리를 비워 두지 않는다. */
 AGENT_UNAUTHORIZED: "인증이 필요합니다.",
 AGENT_BODY_NOT_JSON: "요청 본문이 올바른 JSON이 아닙니다.",
 AGENT_BODY_UNSTORABLE_TEXT: "요청 본문에 저장할 수 없는 문자가 들어 있습니다.",
 AGENT_IDEMPOTENCY_KEY_TOO_LONG:
 "Idempotency-Key가 너무 깁니다.",

 API_KEY_NAME_INVALID: "API Key 이름이 올바르지 않습니다.",

 PROJECT_SLUG_RESERVED: ({ slug }) =>
 `'${slug}'는 화면 주소로 쓰이는 이름이라 Project slug로 쓸 수 없습니다.`,
 PROJECT_SLUG_TAKEN: "같은 slug의 Project가 이미 있습니다.",
 PROJECT_NAME_TAKEN:
 "같은 이름의 Project가 이미 있습니다. slug를 직접 정해 주세요.",
 PROJECT_NOT_FOUND: "Project를 찾을 수 없습니다.",
 MOVE_TARGET_PROJECT_NOT_FOUND: "옮길 Project를 찾을 수 없습니다.",
 REPOSITORY_NOT_FOUND: "Repository를 찾을 수 없습니다.",

 KNOWLEDGE_PAGE_SLUG_RESERVED: ({ slug }) =>
 `'${slug}'는 화면 주소로 쓰이는 이름이라 문서 slug로 쓸 수 없습니다.`,
 KNOWLEDGE_PAGE_SLUG_TAKEN: "같은 slug의 문서가 이미 있습니다.",
 KNOWLEDGE_PAGE_NOT_FOUND: "문서를 찾을 수 없습니다.",

 /** 🔴 없다·만료됐다·이미 쓰였다를 구분해 알려 주지 않는다. */
 INVITATION_UNUSABLE: "사용할 수 없는 초대입니다.",
 INVITATION_NOT_CANCELABLE: "취소할 수 있는 초대가 아닙니다.",
 INVITATION_ALREADY_PENDING:
 "이 이메일로 보낸 초대가 아직 유효합니다. 기존 링크를 전달하거나, 수락 대기 목록에서 취소한 뒤 다시 초대해 주세요.",

 WORKSPACE_MEMBER_ALREADY: "이미 이 Workspace의 멤버입니다.",
 WORKSPACE_MEMBER_NOT_FOUND: "멤버를 찾을 수 없습니다.",
 WORKSPACE_NAME_REQUIRED: "Workspace 이름을 입력하세요.",
 WORKSPACE_NAME_UNUSABLE:
 "그 이름으로 Workspace 주소를 만들지 못했습니다. 다른 이름을 써 주세요.",
 WORKSPACE_LAST_OWNER:
 "마지막 OWNER입니다. 다른 멤버를 OWNER로 올린 뒤에 바꿔 주세요.",
 PERSONAL_WORKSPACE_ROLE_FIXED:
 "Personal Workspace의 주인은 역할을 바꿀 수 없습니다.",
 /** 🔴 「나가기」를 알려 주지 않는다 — 아직 없는 기능이다. */
 WORKSPACE_SELF_REMOVE: "자기 자신은 내보낼 수 없습니다.",
 PERSONAL_WORKSPACE_OWNER_FIXED:
 "개인 워크스페이스의 주인은 내보낼 수 없습니다.",
 WORKSPACE_NOT_FOUND: "워크스페이스를 찾을 수 없습니다.",
 WORKSPACE_OWNER_REQUIRED: "워크스페이스를 찾을 수 없습니다.",
 PERSONAL_WORKSPACE_UNDELETABLE:
 "개인 워크스페이스는 삭제할 수 없습니다.",
 /** 🔴 정책이 정한 문구 그대로다. 「무엇을 먼저 하면 되는지」가 문장 안에 있다. */
 WORKSPACE_HAS_MEMBERS:
 "다른 멤버가 있는 Workspace는 삭제할 수 없습니다. 먼저 멤버를 내보내세요.",

 ACCOUNT_NOT_FOUND: "계정을 찾을 수 없습니다.",
 ACCOUNT_LAST_OWNER:
 "다른 멤버가 있는 워크스페이스의 마지막 OWNER입니다. 다른 멤버를 OWNER로 올린 뒤 다시 시도해 주세요.",
 WORKSPACE_SLUG_RELEASE_FAILED:
 "워크스페이스 주소를 바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
 } satisfies AppErrorMessages,

 notFound: {
 title: "없는 주소입니다.",
 back: "대시보드로",
 },

 /**
 * 브라우저 탭에 뜨는 이름.
 *
 * 🔴 **사이드바의 낱말과 같아야 한다.** 탭만 영어로 남으면 「대시보드」를 열어 두고
 * 탭에는 `Dashboard` 가 뜬다 — 같은 화면을 두 이름으로 부르는 셈이다.
 * Root Layout 의 `template` 이 뒤에 제품 이름을 붙인다.
 */
 metaTitle: {
 login: "로그인",
 invite: "초대",
 dashboard: "대시보드",
 projects: "프로젝트",
 members: "멤버",
 settings: "설정",
 wiki: "위키",
 wikiNew: "새 문서",
 wikiEdit: "문서 수정",
 project: "프로젝트",
 projectSettings: "프로젝트 설정",
 reviews: "리뷰",
 review: "리뷰",
 issues: "이슈",
 issue: "이슈",
 repositories: "저장소",
 repository: "저장소",
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
 * typecheck 가 깨진다** — 그것이 라이브러리 없이 이 방식을 고른 이유다.
 */
export type Messages = typeof ko;
