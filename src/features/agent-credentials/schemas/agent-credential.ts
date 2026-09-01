import { z } from "zod";

import { API_KEY_EXPIRY_OPTIONS } from "@/features/api-keys/schemas/api-key";

export const issueAgentCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiry: z.enum(API_KEY_EXPIRY_OPTIONS).default("NEVER"),
  capability: z.enum(["READ_ONLY", "READ_WRITE"]).default("READ_WRITE"),
});

export type IssueAgentCredentialInput = z.output<
  typeof issueAgentCredentialSchema
>;
export type IssueAgentCredentialFormValues = z.input<
  typeof issueAgentCredentialSchema
>;
