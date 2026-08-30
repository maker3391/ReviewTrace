import type { Metadata } from "next";

import { PageContainer } from "@/components/molecules/PageContainer";
import { Section } from "@/components/molecules/Section";
import { AgentIntegrationPanel } from "@/features/api-keys/components/AgentIntegrationPanel";
import { ApiKeyPanel } from "@/features/api-keys/components/ApiKeyPanel";
import { listApiKeys } from "@/features/api-keys/server/api-key-service";
import { listProjectOptions } from "@/features/projects/server/project-service";
import { listWorkspaceMembers } from "@/features/invitations/server/invitation-service";
import { DeleteAccountPanel } from "@/features/users/components/DeleteAccountPanel";
import { findAccountDeletionImpact } from "@/features/users/server/account-deletion-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { readMessages } from "@/lib/ui/appearance";
import { serverEnv } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.settings };
}

/**
 * Workspace 설정.
 *
 * 멤버·초대는 Members 화면으로 옮겼다(스펙 3) — 이 화면은 **Workspace 자신에 대한 것**만
 * 다룬다.
 *
 * 🔴 **API Key 는 OWNER 에게만 보인다.** 그 Workspace 의 Agent API 를 통째로 여는
 * 자격이라 초대와 같은 급이다 — 화면에서 감추는 것은 편의일 뿐이고, 실제 판정은
 * Server Action 안의 `requireOwner` 가 한다(CLAUDE.md 11).
 *
 * 🔴 **아직 없는 것을 있는 것처럼 그리지 않는다.** Workspace 이름·slug 변경은 만들지 않았다.
 */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { user, workspace } = await requireWorkspace(workspaceSlug);
  const messages = await readMessages();
  const t = messages.settings;
  const keys = messages.apiKeys;

  const isOwner = workspace.role === "OWNER";

  const [members, projects, apiKeys, accountImpact] = await Promise.all([
    listWorkspaceMembers(workspace.workspaceId),
    listProjectOptions(workspace.workspaceId),
    // 🔴 OWNER 가 아니면 조회하지도 않는다. 화면에서 감추는 것으로 대신하지 않는다.
    isOwner ? listApiKeys(workspace.workspaceId) : Promise.resolve([]),
    /*
      🔴 **이 Workspace 가 아니라 «이 사람»의 범위다.** 계정 삭제는 지금 보고 있는
      Workspace 하나가 아니라 그가 속한 전부에 걸린다 — 그래서 조회도 `userId` 로 한다.
    */
    findAccountDeletionImpact(user.id),
  ]);

  return (
    <PageContainer className="gap-8">
      {/*
        🔴 **맨 위에 「설정」을 다시 적지 않는다.** 사이드바가 이미 그 낱말이고, 아래
        Section 머리글(워크스페이스 · API Key · Agent 연동 · 계정)이 화면의 구조다.
      */}
      <Section title={t.workspaceSection}>
        {/*
          🔴 **둘째 트랙은 `minmax(0,1fr)` 다.** 그냥 `1fr` 이면 최소 폭이 «내용»이라,
          slug 처럼 끊을 자리가 없는 문자열이 트랙을 밀어 좁은 화면에서 표가 컨테이너
          밖으로 나간다 — 390px 에서 3px, 320px 에서 73px 넘쳤다(실측).
          `ReviewDetailScreen` 의 같은 `dl` 은 처음부터 이 모양이라 넘치지 않는다.
          라벨 트랙도 좁은 화면에서 한 단계 줄인다 — 8rem 을 320px 에 그대로 두면
          값에 남는 폭이 절반 아래로 떨어진다.
        */}
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 pt-3 text-sm wrap-anywhere sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-x-6">
          <dt className="text-xs text-muted-foreground">{t.workspaceName}</dt>
          <dd className="font-medium">{workspace.name}</dd>

          <dt className="text-xs text-muted-foreground">slug</dt>
          <dd className="font-mono text-xs">{workspace.slug}</dd>

          <dt className="text-xs text-muted-foreground">{t.workspaceKind}</dt>
          <dd className="text-xs">
            {workspace.isPersonal ? t.kindPersonal : t.kindTeam}
          </dd>

          <dt className="text-xs text-muted-foreground">{t.myRole}</dt>
          {/* 🔴 값(`OWNER`)이 아니라 그 이름표를 그린다(`config/messages/ko.ts` 머리말). */}
          <dd className="text-xs">{messages.enums.role[workspace.role]}</dd>

          {/*
            🔴 **Settings 는 Dashboard 가 아니다.** Projects·Members 수는 여기서 「비교할
            지표」가 아니라 **이 Workspace 가 어떤 상태인가**를 말하는 한 줄이다 — KPI Card 로
            키우면 정보량에 비해 화면을 통째로 먹고, 이 화면의 주인공(설정)보다 눈에 띈다
            (CLAUDE.md 16). 그래서 Section 을 없애고 Workspace 기본 정보의 한 행으로 내렸다.
          */}
          <dt className="text-xs text-muted-foreground">{t.scale}</dt>
          <dd className="flex items-center gap-2.5 text-xs">
            <span className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">{t.statProjects}</span>
              <span className="font-medium tabular-nums">{projects.length}</span>
            </span>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">{t.statMembers}</span>
              <span className="font-medium tabular-nums">{members.length}</span>
            </span>
          </dd>
        </dl>
      </Section>

      {isOwner && (
        <Section title={t.apiKeysSection}>
          {/*
            🔴 문구는 서버가 읽어 «그리는 낱말만» 넘긴다 — Client Component 는 쿠키를
            스스로 읽을 수 없다(CLAUDE.md 11).
          */}
          <ApiKeyPanel
            workspaceSlug={workspace.slug}
            apiKeys={apiKeys}
            labels={{
              ...keys,
              expiry: {
                "30": keys.expiry30,
                "90": keys.expiry90,
                "365": keys.expiry365,
                NEVER: keys.expiryNever,
              },
            }}
          />
        </Section>
      )}

      {isOwner && (
        <Section title={t.integrationSection} variant="raised" bleed>
          {/*
            🔴 **주소만 서버가 채우고 키는 채우지 않는다.** 키가 사람 눈에 보이는 자리는
            발급 직후 1회뿐이다 — 여기에 끼워 넣으면 화면·복사기록·스크린샷으로 한 번 더
            퍼진다(CLAUDE.md 11·19).
          */}
          <AgentIntegrationPanel
            apiUrl={serverEnv().APP_URL}
            labels={{
              ...messages.integration,
              copy: keys.copy,
              copied: keys.copied,
              /*
                🔴 **함수는 여기서 끝난다.** 사전의 `copyCommand` 는 함수라 그대로 넘기면
                「Functions cannot be passed directly to Client Components」로 이 화면
                전체가 오류로 떨어진다 — 서버에서 완성한 «문자열»만 건넨다(CLAUDE.md 7).
              */
              copyCommand: {
                step1: messages.integration.copyCommand(
                  messages.integration.step1,
                ),
                step2: messages.integration.copyCommand(
                  messages.integration.step2,
                ),
              },
              note: {
                "claude-code": messages.integration.claudeNote,
                codex: messages.integration.codexNote,
              },
            }}
          />
        </Section>
      )}

      {/*
        🔴 **Workspace 설정이 아니라 «계정» 이다.** 이 화면 아래에 두지만 지금 보고 있는
        Workspace 하나에 대한 일이 아니다 — 그래서 OWNER 조건이 붙지 않는다. 자기 계정을
        지우는 것은 역할과 무관하다.

        🔴 **서버가 그릴 것만 넘긴다.** 내부 id 도, 남의 Workspace 도 내려가지 않는다
        (CLAUDE.md 11·19).
      */}
      <Section title={t.accountSection}>
        <DeleteAccountPanel
          deleted={accountImpact.deleted.map((entry) => ({
            slug: entry.slug,
            name: entry.name,
          }))}
          preserved={accountImpact.preserved.map((entry) => ({
            slug: entry.slug,
            name: entry.name,
            slugRotated: entry.rotateSlug,
          }))}
          blocked={accountImpact.blocked.map((entry) => ({
            slug: entry.slug,
            name: entry.name,
          }))}
          losses={accountImpact.losses}
          confirmValue={accountImpact.confirmValue}
          labels={messages.account}
        />
      </Section>
    </PageContainer>
  );
}
