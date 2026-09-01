/**
 * ReviewTrace Agent API 를 부르는 얇은 Client.
 *
 * ## 🔴 MCP 는 새로운 권한 경계가 아니다(스펙 19)
 *
 * 이 파일에 업무 규칙이 없다. Tenant 판정 · Repository 소유 · Validation · Evidence 확인은
 * 전부 저쪽(Agent API)이 한다. 여기서 무언가를 「미리 걸러 주면」 두 통로가 서로 다른
 * 규칙을 갖게 되고, 그 차이가 곧 우회로가 된다.
 *
 * ## 🔴 Key 는 헤더에만 있다(스펙 8)
 *
 * URL·오류 message·Tool 응답 어디에도 넣지 않는다. 실패를 옮길 때 서버 본문을 그대로
 * 흘리지 않고 **Agent 가 다음 행동을 정할 수 있는 만큼만** 옮긴다(스펙 18).
 */

/** 한 번의 호출에 허용하는 시간. Agent 를 무한정 붙잡아 두지 않는다. */
const TIMEOUT_MS = 20_000;

/** 한 요청 본문의 상한. Agent 가 파일을 통째로 실어 보내는 것을 여기서 먼저 막는다. */
const MAX_BODY_BYTES = 4_000_000;

export class ApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createClient({ apiUrl, apiKey }) {
  async function call(method, path, { body, query, idempotencyKey } = {}) {
    const url = new URL(`${apiUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      // 🔴 Key 는 이 한 줄에만 있다.
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    };

    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      if (Buffer.byteLength(payload, "utf8") > MAX_BODY_BYTES) {
        throw new ApiError(
          "보내려는 내용이 너무 크다. Code Evidence 의 snapshot 을 문제가 있는 줄 범위로 줄여라.",
        );
      }
      headers["content-type"] = "application/json";
    }

    // 같은 Review 의 재전송을 한 번으로 접는 열쇠. 없으면 접지 않는다 —
    // 「같은 Commit 을 두 번 Review 했다」는 정상이고 우리가 마음대로 접으면 안 된다.
    if (typeof idempotencyKey === "string" && idempotencyKey !== "") {
      headers["idempotency-key"] = idempotencyKey;
    }

    /**
     * 🔴 **재시도는 «같은 열쇠를 든 요청»에만 허용한다.**
     *
     * 서버가 저장을 끝낸 뒤 응답만 유실되면(timeout·연결 끊김) 이쪽은 실패로 보인다.
     * `Idempotency-Key` 가 있으면 같은 헤더로 한 번 더 보내 서버가 200 replay 로 접어
     * 주게 만들 수 있다.
     *
     * 🔴 **열쇠가 없는 변경 요청은 절대 다시 보내지 않는다.** `add_issue`·활동 추가·
     * 상태 전이는 열쇠가 없어서, 커밋된 뒤 응답만 잃은 요청을 다시 보내면 **Issue 나
     * Activity 가 두 번 저장된다.** 실패를 그대로 알리는 편이 조용히 두 줄을 남기는 것보다
     * 낫다 — Agent 는 `get_issue` 로 확인하고 판단할 수 있다.
     *
     * 🔴 **응답을 받은 실패(4xx·5xx)는 재시도하지 않는다.** 그것은 「닿았다」이므로
     * 다시 보낸다고 달라지지 않고, 5xx 를 계속 두드리면 서버를 더 무너뜨린다.
     */
    const replayable =
      typeof idempotencyKey === "string" && idempotencyKey !== "";

    /**
     * 🔴 **본문을 읽는 것까지가 한 번의 시도다.**
     *
     * `fetch` 는 헤더만 받아도 성공으로 돌아온다 — 본문을 읽는 도중 연결이 끊기면
     * 예외가 `response.text()` 에서 난다. 그것을 재시도 밖에 두면, 서버는 이미 저장했는데
     * 이쪽은 실패로 끝나고 **다음 호출이 새 열쇠를 만들어** 같은 Review 가 두 번 저장된다.
     */
    async function attempt() {
      const response = await fetch(url, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      /**
       * 🔴 **오류 응답을 받았으면 그 사실을 잃지 않는다.**
       *
       * 4xx·5xx 헤더를 받은 뒤 오류 «본문»만 끊겨도 여기서 예외가 나면, 부르는 쪽은
       * 「닿지 못했다」로 읽고 같은 POST 를 다시 보낸다 — 「응답을 받은 실패는
       * 재시도하지 않는다」는 정책이 정확히 그 자리에서 깨진다. 본문은 사람이 읽을
       * message 를 얻는 데 쓸 뿐이므로, 못 읽으면 빈 값으로 두고 상태만 들고 나간다.
       */
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { status: response.status, ok: false, text };
      }

      return { status: response.status, ok: true, text: await response.text() };
    }

    let result;
    try {
      result = await attempt();
    } catch {
      if (!replayable) {
        // 🔴 원인을 그대로 옮기지 않는다 — 주소가 message 에 섞여 나올 수 있다.
        throw new ApiError(
          `ReviewTrace 서버에 닿지 못했다 (${apiUrl}). 저장됐는지 알 수 없으므로 다시 보내지 않았다 — ` +
            `get_issue 나 search_issues 로 확인해라.`,
        );
      }

      try {
        result = await attempt();
      } catch {
        throw new ApiError(
          `ReviewTrace 서버에 닿지 못했다 (${apiUrl}). 서버가 떠 있는지, REVIEWTRACE_API_URL 이 맞는지 확인해라.`,
        );
      }
    }

    const parsed = result.text === "" ? null : safeParse(result.text);

    if (!result.ok) {
      throw toApiError(result.status, parsed);
    }

    return parsed;
  }

  return {
    createReview: (body, idempotencyKey) =>
      call("POST", "/reviews", { body, idempotencyKey }),
    appendIssues: (reviewId, issues) =>
      call("POST", `/reviews/${encodeURIComponent(reviewId)}/issues`, {
        body: { issues },
      }),
    addActivity: (issueId, body) =>
      call("POST", `/issues/${encodeURIComponent(issueId)}/activities`, {
        body,
      }),
    updateStatus: (issueId, body) =>
      call("PATCH", `/issues/${encodeURIComponent(issueId)}`, { body }),
    getIssue: (issueId) =>
      call("GET", `/issues/${encodeURIComponent(issueId)}`),
    searchIssues: (query) => call("GET", "/issues", { query }),
    knowledgeContext: (query) => call("GET", "/knowledge/context", { query }),
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * HTTP 실패를 **Agent 가 다음 행동을 정할 수 있는 말**로 바꾼다(스펙 18).
 *
 * 🔴 서버 본문을 그대로 옮기지 않는다. Stack·SQL·내부 경로가 Tool 결과로 나가지 않게
 * 우리가 아는 뜻만 적는다.
 */
function toApiError(status, parsed) {
  const code = parsed?.error?.code ?? null;
  const serverMessage =
    typeof parsed?.error?.message === "string" ? parsed.error.message : null;

  if (status === 401) {
    return new ApiError(
      "ReviewTrace API Key 가 유효하지 않다 (없음 · 폐기됨 · 만료됨). Workspace Settings > API Keys 에서 새로 발급해라.",
      { status, code },
    );
  }
  if (status === 403) {
    return new ApiError("이 Workspace 에 접근할 수 없다.", { status, code });
  }
  if (status === 404) {
    return new ApiError(
      "대상을 찾지 못했다. 이 API Key 의 Workspace 안에 있는 것인지 확인해라.",
      { status, code },
    );
  }
  if (status === 400 || status === 422) {
    return new ApiError(serverMessage ?? "보낸 값이 계약에 맞지 않다.", {
      status,
      code,
    });
  }
  if (status === 429) {
    return new ApiError("요청이 너무 잦다. 잠시 뒤 다시 시도해라.", {
      status,
      code,
    });
  }

  return new ApiError(
    `ReviewTrace 서버가 요청을 처리하지 못했다 (HTTP ${status}).`,
    { status, code },
  );
}
