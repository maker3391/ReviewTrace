export const AGENT_PRINCIPAL_TYPES = ["USER_AGENT", "SERVICE_AGENT"] as const;

export type AgentPrincipalType = (typeof AGENT_PRINCIPAL_TYPES)[number];

export const AGENT_CAPABILITIES = ["READ", "WRITE"] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];
