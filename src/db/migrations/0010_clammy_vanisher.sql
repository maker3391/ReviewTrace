CREATE TYPE "public"."agent_principal_type" AS ENUM('USER_AGENT', 'SERVICE_AGENT');--> statement-breakpoint
CREATE TABLE "agent_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"capability_scopes" text[] DEFAULT array['READ', 'WRITE']::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "agent_principal_type" NOT NULL,
	"owner_user_id" uuid,
	"display_name" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_workspace_grants" (
	"principal_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_workspace_grants_principal_id_workspace_id_pk" PRIMARY KEY("principal_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspace_grants" ADD CONSTRAINT "agent_workspace_grants_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspace_grants" ADD CONSTRAINT "agent_workspace_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspace_grants" ADD CONSTRAINT "agent_workspace_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_key_hash_unique" ON "agent_credentials" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "agent_credentials_principal_idx" ON "agent_credentials" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "agent_principals_owner_idx" ON "agent_principals" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_principals_active_user_owner_unique" ON "agent_principals" USING btree ("owner_user_id") WHERE "agent_principals"."type" = 'USER_AGENT' and "agent_principals"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "agent_workspace_grants_workspace_idx" ON "agent_workspace_grants" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_workspace_grants_principal_active_idx" ON "agent_workspace_grants" USING btree ("principal_id","workspace_id") WHERE "agent_workspace_grants"."revoked_at" is null;