/**
 * Tag 이름 정규화.
 *
 * Tag 는 자유도가 높은 Keyword 다(CLAUDE.md 3). 자유롭다는 것은 Agent 마다
 * `Race Condition` · `race_condition` · `RACE-CONDITION` 을 보낸다는 뜻이고, 그대로 두면
 * 같은 개념이 Workspace 안에서 세 행으로 갈라져 통계가 셋으로 나뉜다.
 *
 * 그래서 **표시용 이름과 대조용 이름을 나눈다.**
 *
 * ```
 * name            사용자가 보낸 그대로 (표시)
 * normalizedName  대조·Unique 의 근거   (스펙 24)
 * ```
 */

/** 표시용 이름의 상한. Tag 는 Keyword 이지 문장이 아니다. */
export const TAG_NAME_MAX_LENGTH = 64;

/**
 * 대조용 이름을 만든다.
 *
 * 소문자화 -> 구분자(공백·`_`·연속 `-`)를 `-` 하나로 -> 앞뒤 `-` 제거.
 * 그 밖의 글자는 지우지 않는다 — 한글 Tag 를 통째로 날려 빈 문자열이 되는 것을 막는다.
 */
export function normalizeTagName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 한 Issue 의 Tag 목록을 정규화하고 중복을 지운다.
 *
 * 🔴 여기서 걸러야 `IssueTag` 의 복합 PK 가 같은 요청 안에서 충돌하지 않는다 —
 * Agent 가 `race-condition` 과 `Race Condition` 을 함께 보내는 일이 실제로 있다.
 * 정규화 결과가 빈 문자열이 되는 값(`"---"` · 공백만)은 버린다.
 */
export interface NormalizedTag {
  name: string;
  normalizedName: string;
}

export function normalizeTagList(raw: readonly string[]): NormalizedTag[] {
  const seen = new Map<string, NormalizedTag>();

  for (const value of raw) {
    const normalizedName = normalizeTagName(value);
    if (normalizedName === "") {
      continue;
    }
    if (!seen.has(normalizedName)) {
      seen.set(normalizedName, { name: value.trim(), normalizedName });
    }
  }

  return [...seen.values()];
}
