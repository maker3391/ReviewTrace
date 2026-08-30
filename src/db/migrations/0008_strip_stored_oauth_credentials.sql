-- 이미 저장돼 버린 OAuth Credential 을 비운다.
--
-- 🔴 코드 수정(`src/lib/auth/account-credentials.ts`)은 «앞으로의 linkAccount 입력»에만
-- 걸린다. 재로그인은 OAuth 계정 행이 이미 있으면 linkAccount 를 다시 부르지 않으므로,
-- 그 코드가 나가기 전에 로그인한 사람의 평문 Token 은 표에 «영원히» 남는다.
-- 안 가지고 있는 것은 샐 수 없다 — 남아 있는 것을 여기서 지운다.
--
-- 🔴 provider 를 좁히지 않는다. 걷어내는 코드가 provider 를 보지 않고 모든 linkAccount 에
-- 걸리므로(CREDENTIAL_FIELDS), 여기서만 GitHub 으로 좁히면 두 자리의 범위가 갈린다.
-- 🔴 지우는 것은 그 두 칸뿐이다. 신원 칸(provider · provider_account_id · user_id · type)이
-- 없으면 재로그인이 사용자를 찾지 못하고, 이력 칸(scope · token_type · expires_at)은
-- Credential 이 아니다.
UPDATE "accounts"
   SET "access_token" = NULL,
       "refresh_token" = NULL
 WHERE "access_token" IS NOT NULL
    OR "refresh_token" IS NOT NULL;
