"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  issueAgentCredentialAction,
  revokeAgentCredentialAction,
  setAgentWorkspaceGrantAction,
} from "@/features/agent-credentials/actions/agent-credential-actions";
import type {
  AgentCredentialSummary,
  AgentWorkspaceGrantOption,
} from "@/features/agent-credentials/server/agent-credential-service";
import { formatDate } from "@/lib/format/date";

export interface AgentCredentialLabels {
  description: string;
  issue: string;
  namePlaceholder: string;
  readOnly: string;
  readWrite: string;
  never: string;
  days30: string;
  days90: string;
  days365: string;
  credentials: string;
  noCredentials: string;
  prefix: string;
  capability: string;
  lastUsed: string;
  status: string;
  active: string;
  revoked: string;
  expired: string;
  revoke: string;
  cancel: string;
  revokeConfirmTitle: string;
  revokeConfirmConsequence: string;
  workspaceAccess: string;
  workspaceAccessDescription: string;
  granted: string;
  notGranted: string;
  grant: string;
  ownerRequired: string;
  issuedTitle: string;
  issuedWarning: string;
  copy: string;
  copied: string;
  close: string;
}

export function AgentCredentialPanel({
  workspaceSlug,
  currentUserId,
  credentials,
  grants,
  labels,
}: {
  workspaceSlug: string;
  currentUserId: string;
  credentials: readonly AgentCredentialSummary[];
  grants: readonly AgentWorkspaceGrantOption[];
  labels: AgentCredentialLabels;
}) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<"30" | "90" | "365" | "NEVER">(
    "NEVER",
  );
  const [capability, setCapability] = useState<
    "READ_ONLY" | "READ_WRITE"
  >("READ_WRITE");
  const [issued, setIssued] = useState<{
    name: string;
    plainToken: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const now = new Date();

  function issue() {
    startTransition(async () => {
      setFailure(null);
      const result = await issueAgentCredentialAction(workspaceSlug, {
        name,
        expiry,
        capability,
      });
      if (!result.ok) return setFailure(result.error.message);
      setIssued(result.data);
      setName("");
    });
  }

  async function revoke() {
    if (revokeTarget === null) {
      return { ok: true, data: undefined } as const;
    }
    return revokeAgentCredentialAction(workspaceSlug, revokeTarget.id);
  }

  function setGrant(option: AgentWorkspaceGrantOption) {
    startTransition(async () => {
      setFailure(null);
      const result = await setAgentWorkspaceGrantAction(
        option.slug,
        currentUserId,
        !option.granted,
      );
      if (!result.ok) setFailure(result.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-5 pt-3">
      <p className="max-w-3xl text-xs text-muted-foreground">
        {labels.description}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={labels.namePlaceholder}
          aria-label={labels.namePlaceholder}
          className="min-w-48 flex-1 sm:max-w-64"
          maxLength={100}
        />
        <select
          value={capability}
          onChange={(event) =>
            setCapability(event.target.value as "READ_ONLY" | "READ_WRITE")
          }
          className="h-9 rounded-md border bg-background px-3 text-sm"
          aria-label={labels.capability}
        >
          <option value="READ_WRITE">{labels.readWrite}</option>
          <option value="READ_ONLY">{labels.readOnly}</option>
        </select>
        <select
          value={expiry}
          onChange={(event) =>
            setExpiry(event.target.value as typeof expiry)
          }
          className="h-9 rounded-md border bg-background px-3 text-sm"
          aria-label={labels.status}
        >
          <option value="NEVER">{labels.never}</option>
          <option value="30">{labels.days30}</option>
          <option value="90">{labels.days90}</option>
          <option value="365">{labels.days365}</option>
        </select>
        <Button size="sm" disabled={pending || name.trim() === ""} onClick={issue}>
          {labels.issue}
        </Button>
      </div>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      <div>
        <h3 className="mb-2 text-xs font-medium">{labels.credentials}</h3>
        {credentials.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">
            {labels.noCredentials}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.credentials}</TableHead>
                <TableHead>{labels.prefix}</TableHead>
                <TableHead>{labels.capability}</TableHead>
                <TableHead>{labels.lastUsed}</TableHead>
                <TableHead>{labels.status}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((credential) => {
                const expired =
                  credential.expiresAt !== null &&
                  credential.expiresAt.getTime() <= now.getTime();
                const active = credential.revokedAt === null && !expired;
                return (
                  <TableRow key={credential.id}>
                    <TableCell className="font-medium">
                      {credential.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {credential.keyPrefix}
                    </TableCell>
                    <TableCell className="text-xs">
                      {credential.capabilityScopes.includes("WRITE")
                        ? labels.readWrite
                        : labels.readOnly}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {credential.lastUsedAt === null
                        ? "—"
                        : formatDate(credential.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {credential.revokedAt !== null
                        ? labels.revoked
                        : expired
                          ? labels.expired
                          : labels.active}
                    </TableCell>
                    <TableCell className="text-right">
                      {active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            setRevokeTarget({
                              id: credential.id,
                              name: credential.name,
                            })
                          }
                        >
                          {labels.revoke}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium">{labels.workspaceAccess}</h3>
        <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
          {labels.workspaceAccessDescription}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>{labels.status}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((option) => (
              <TableRow key={option.workspaceId}>
                <TableCell>
                  <span className="font-medium">{option.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {option.slug}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {option.granted ? labels.granted : labels.notGranted}
                </TableCell>
                <TableCell className="text-right">
                  {option.role === "OWNER" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setGrant(option)}
                    >
                      {option.granted ? labels.revoke : labels.grant}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {labels.ownerRequired}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={issued !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIssued(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{labels.issuedTitle}</DialogTitle>
            <DialogDescription>{labels.issuedWarning}</DialogDescription>
          </DialogHeader>
          <code className="block overflow-x-auto rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-[13px] whitespace-nowrap select-all">
            {issued?.plainToken}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssued(null)}>
              {labels.close}
            </Button>
            <Button
              onClick={() => {
                if (issued !== null) {
                  void navigator.clipboard.writeText(issued.plainToken);
                  setCopied(true);
                }
              }}
            >
              {copied ? labels.copied : labels.copy}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title={labels.revokeConfirmTitle}
        description={
          <span className="font-medium text-foreground">
            {revokeTarget?.name}
          </span>
        }
        consequence={labels.revokeConfirmConsequence}
        actionLabel={labels.revoke}
        cancelLabel={labels.cancel}
        onConfirm={revoke}
      />
    </div>
  );
}
