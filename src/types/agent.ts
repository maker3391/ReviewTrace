export const AGENT_PRINCIPAL_TYPES = ["USER_AGENT", "SERVICE_AGENT"] as const;

export type AgentPrincipalType = (typeof AGENT_PRINCIPAL_TYPES)[number];

export const AGENT_CAPABILITIES = ["READ", "WRITE"] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const AGENT_REVIEW_LANGUAGES = ["ko", "en"] as const;

export type AgentReviewLanguage = (typeof AGENT_REVIEW_LANGUAGES)[number];
