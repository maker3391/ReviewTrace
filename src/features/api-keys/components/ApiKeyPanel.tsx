"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  issueApiKeyAction,
  revokeApiKeyAction,
} from "@/features/api-keys/actions/api-key-actions";
import {
  API_KEY_EXPIRY_LABEL,
  API_KEY_EXPIRY_OPTIONS,
  issueApiKeySchema,
  type IssueApiKeyFormValues,
  type IssueApiKeyInput,
} from "@/features/api-keys/schemas/api-key";
import type { ApiKeySummary } from "@/features/api-keys/server/api-key-service";
import { formatDate } from "@/lib/format/date";

/**
 * API Key 발급·폐기 화면.
 *
 * 🔴 **원문은 «발급 응답에만» 존재한다.** 서버에는 Hash 만 남으므로 이 화면을 떠나면 다시
 * 볼 수 없다(CLAUDE.md 12). 그래서 발급 결과를 Dialog 로 **한 번** 보여 주고, 닫으면 State
 * 에서도 지운다.
 *
 * 🔴 **목록은 `plainToken` 도 `keyHash` 도 받지 않는다.** 서버가 아예 넘기지 않는다 —
 * 넘기면 RSC payload 로 페이지 소스에 실려 나간다(CLAUDE.md 11).
 *
 * 🔴 **폐기는 행 삭제가 아니라 `revokedAt` 이다.** 지우면 「이 키가 언제까지 무엇을 했는가」가
 * 함께 사라진다.
 */
export function ApiKeyPanel({
  workspaceSlug,
  apiKeys,
}: {
  workspaceSlug: string;
  apiKeys: readonly ApiKeySummary[];
}) {
  const [issued, setIssued] = useState<{
    plainToken: string;
    name: string;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<IssueApiKeyFormValues, unknown, IssueApiKeyInput>({
    resolver: zodResolver(issueApiKeySchema),
    defaultValues: { name: "", expiry: "NEVER" },
  });

  async function onIssue(values: IssueApiKeyInput) {
    setFailure(null);

    const result = await issueApiKeyAction(workspaceSlug, values);

    if (!result.ok) {
      // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다(CLAUDE.md 19).
      setFailure(result.error.message);
      return;
    }

    setIssued({ plainToken: result.data.plainToken, name: result.data.name });
    form.reset();
  }

  async function onRevoke(apiKeyId: string) {
    setFailure(null);
    setRevoking(apiKeyId);

    const result = await revokeApiKeyAction(workspaceSlug, apiKeyId);

    setRevoking(null);
    if (!result.ok) {
      setFailure(result.error.message);
    }
    // 목록은 서버가 다시 그린다 — 여기서 State 를 손보지 않는다(CLAUDE.md 8).
  }

  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={form.handleSubmit(onIssue)}
        className="flex items-start gap-2 pt-3"
      >
        <div className="flex flex-col gap-1">
          <Input
            {...form.register("name")}
            placeholder="Key 이름 — 예: codex-ci"
            aria-label="Key 이름"
            className="w-64"
          />
          {form.formState.errors.name !== undefined && (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        {/*
          🔴 `form.watch()` 로 값을 읽지 않는다 — 매 렌더마다 새 함수를 돌려줘 메모이제이션이
          깨진다(React Compiler 가 이 Component 를 통째로 건너뛴다). Select 처럼 등록되지 않는
          입력은 `Controller` 로 잇는다 — 기존 IssueFilterBar 와 같은 방식이다.
        */}
        <Controller
          control={form.control}
          name="expiry"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-36" aria-label="만료">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_KEY_EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {API_KEY_EXPIRY_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />

        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          발급
        </Button>
      </form>

      {failure !== null && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      {apiKeys.length === 0 ? (
        <p className="py-6 text-xs text-muted-foreground">
          발급된 Key 가 없습니다.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead className="w-40">Prefix</TableHead>
              <TableHead className="w-28">마지막 사용</TableHead>
              <TableHead className="w-28">만료</TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-20 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.map((key) => {
              const expired =
                key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime();
              const dead = key.revokedAt !== null || expired;

              return (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {key.keyPrefix}…
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {key.lastUsedAt === null ? "—" : formatDate(key.lastUsedAt)}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {key.expiresAt === null ? "없음" : formatDate(key.expiresAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {key.revokedAt !== null
                      ? "폐기됨"
                      : expired
                        ? "만료됨"
                        : "사용 중"}
                  </TableCell>
                  <TableCell className="text-right">
                    {!dead && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revoking === key.id}
                        onClick={() => onRevoke(key.id)}
                      >
                        {revoking === key.id ? "폐기 중" : "폐기"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={issued !== null}
        onOpenChange={(open) => {
          if (!open) {
            // 🔴 닫으면 State 에서도 지운다. 원문을 브라우저 메모리에 남겨 둘 이유가 없다.
            setIssued(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">
              {issued?.name} 발급됨
            </DialogTitle>
            <DialogDescription>
              지금 복사하세요. 이 값은 서버에 저장되지 않아 다시 볼 수 없습니다.
            </DialogDescription>
          </DialogHeader>

          <code className="block break-all rounded-sm border border-border bg-muted/40 p-3 font-mono text-xs">
            {issued?.plainToken}
          </code>

          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (issued !== null) {
                  void navigator.clipboard.writeText(issued.plainToken);
                  setCopied(true);
                }
              }}
            >
              {copied ? "복사됨" : "복사"}
            </Button>
            <Button size="sm" onClick={() => setIssued(null)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
