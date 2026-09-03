import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ApiError } from "./client.mjs";
import {
  GitError,
  classifyEvidenceSource,
  readRepositoryContext,
  repositoryFromFullName,
} from "./git.mjs";

/**
 * ReviewTrace MCP Tool 집합(스펙 5·6·16).
 *
 * ## 🔴 Tool 개수보다 「실수하기 어려운 흐름」을 먼저 본다
 *
 * ```
 * create_review -> add_issue* -> add_fix_attempt -> review_again -> resolve_issue
 * ^ |
 * +----- get_issue · search_issues · get_knowledge ---+
 * ```
 *
 * **Evidence 를 붙이는 Tool 을 따로 만들지 않았다.** 근거는 언제나 「무언가를 기록하는
 * 순간」에 생긴다 — 따로 두면 Agent 가 기록하고 근거 붙이기를 **잊는다.** 그래서
 * `add_issue` · `add_fix_attempt` · `resolve_issue` 가 각자 `evidence` 를 함께 받는다.
 *
 * 🔴 **내부 ID 를 사람에게 묻지 않는다**(스펙 6). Repository 는 git remote 에서 나오고,
 * `reviewId` 는 방금 만든 것을 이 프로세스가 기억한다.
 *
 * 🔴 **업무 규칙이 여기 없다.** Tenant 판정·검증·Evidence 확인은 전부 Agent API 가 한다.
 */

const severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
const category = z.enum([
  "ARCHITECTURE",
  "SECURITY",
  "PERFORMANCE",
  "DATABASE",
  "TRANSACTION",
  "CONCURRENCY",
  "API",
  "VALIDATION",
  "EXCEPTION_HANDLING",
  "TESTING",
  "CLEAN_CODE",
  "RELIABILITY",
]);

/**
 * Review Knowledge 를 쓰는 방식의 정본.
 *
 * 🔴 **여기 한 곳에만 둔다.** 예전에는 이 문단이 narrative field «마다» 통째로 붙었다 —
 * field 의 목적은 「무엇을 했는가」 여섯 글자인데 형식 규칙이 그 열 배였다. 그러면 Agent 가
 * 받는 신호에서 **형식이 내용을 덮는다.** 이제 전체 규칙은 server instructions 가 한 번
 * 말하고, 각 field 는 「이 칸이 무엇을 담는가 + 그 내용에 맞는 모양」만 짧게 말한다.
 *
 * 🔴 **판단 기준은 「Markdown 문법을 얼마나 썼는가」가 아니다.** 읽는 사람이 화면을 처음
 * 봤을 때 **5초 안에 구조와 핵심 판단을 훑을 수 있는가**다.
 *
 * 🔴 **이 계약은 한 번 반대로 기울어진 적이 있다.** 「억지로 구조를 만들지 않는다」를
 * 앞세웠더니 실제 Agent 가 서로 다른 논점 셋을 **긴 문단 셋으로 이어 붙여** 블로그 글처럼
 * 썼다(실제 생성한 Issue 에서 확인). 기준은 **길이나 문단 수가 아니라 semantic topic
 * boundary** 다 — 논점이 갈리면 나누고, 하나의 인과가 이어지면 문단으로 둔다.
 *
 * 🔴 **그 뒤에도 「문단을 «무엇으로» 나누는가」가 빠져 있었다.** heading·bullet·nested·ordered 는
 * 말하면서 문단의 기준을 말하지 않으니, 한 문단에 증상·근거·반전·증거가 그대로 뭉쳤다.
 * 기준은 **semantic role** 이다 — 한 문단에는 핵심 역할 하나. 글자 수·줄 길이·화면 폭이 아니고,
 * 접속사를 봤다고 나누는 것도 아니다. **역할이나 관점이 실제로 바뀔 때만** 새 문단이다.
 * 🔴 그리고 그 규칙은 **여기 한 줄 묶음으로만** 산다 — 11개 field 설명에 복사하는 순간
 * 위의 첫 번째 실패(형식이 목적을 덮는 것)가 그대로 되돌아온다.
 *
 * 🔴 **세 번째 기울어짐은 형식이 아니라 «추상화 수준»이었다.** 위 두 교정이 전부 Markdown
 * 구조에 관한 것이라, 계약을 완벽히 지키면서도 `<h4>` · `className` · DOM tag 를 주어로 삼은
 * 「JSX debugging note」가 나올 수 있었다 — 실제로 그렇게 쌓였다(2026-09-03). 형식은 옳고
 * 내용의 눈높이가 틀린 경우다.
 *
 * 🔴 **그 교정이 곧바로 반대편으로 넘어갔다.** 「identifier 는 최소한만」이 «정확도를 깎는»
 * 쪽으로 작동해, 원인을 짚는 데 필요한 이름까지 지운 은유적인 문장이 나왔다 — 「그런 통로가
 * 없다」·「그 자리에 적힌 값이다」. 읽는 사람이 다시 해석해야 하면 abstraction 이 아니라
 * **vagueness** 다. 그래서 지금 계약은 둘을 함께 말한다: 구현 세부는 숨기되 **문장은 가장
 * 직접적으로**, 원인을 정확하게 만드는 identifier 는 **지우지 않는다.**
 *
 * 기준은 **behavior · causality · impact** 다. source-level detail 은 근거이지 주어가 아니고,
 * 근거를 담는 칸은 이미 따로 있다(Code Evidence). 그래서 이 규칙은 「무엇을 쓰지 마라」가
 * 아니라 **「그것을 어디에 두어라」**로 적었다.
 *
 * ## 🔴 네 번째 기울어짐 — 계약이 «좋은 문서의 모델»이 아니라 «실패 목록»으로 자랐다
 *
 * 위 세 교정이 전부 **추가**로 처리돼, 금지 문장이 생성 지침을 압도했다. 그러면 Agent 는
 * 위반을 피하는 쪽으로 최적화해 **가장 안전한 모양**(문단 + `##` 두어 개)에 수렴한다.
 *
 * 구조를 정하는 문장이 사실상 하나였는데 그 대응표에 **table 과 blockquote 가 없었다** —
 * `table`·`blockquote` 는 계약 전문에 한 번도 등장하지 않았고 code block 은 제한으로만
 * 등장했다. 여러 대상의 같은 속성을 비교하는 내용이 prose 로 흘러내린 것은 규칙을 어겨서가
 * 아니라 **쓸 구조가 목록에 없어서**였다.
 *
 * 그리고 field 사이의 규칙이 「되풀이하지 마라」**뿐**이었다. 중복 금지만 있고 연속성이 없으면
 * 각 field 가 **서로 겹치지 않는 독립된 미니 보고서**가 된다 — 원하던 「한 문서」의 반대다.
 *
 * 그래서 2026-09-03 에 **더하지 않고 재조정**했다(약 30문장 -> 20문장):
 *
 * - 관계 -> 구조 대응표를 **완성**했다. table·blockquote·code block·inline code 가 들어가고,
 *   그 자리에 있던 개별 문장 넷(ordered·nested·code block 제한 등)은 표에 흡수돼 사라졌다
 * - **field = chapter** 를 선언했다. 세 규칙(`한 번만 설명`·`FIELD_HINT`·field 책임)을 하나로 합쳤다
 * - 🔴 **`##`/`###` 층 개수 지시를 지웠다.** 그것이 「긴 prose + heading 두 개」를 직접 만들었다
 * - 🔴 **「판단을 바꾸지 않는 실측값은 생략」을 뒤집었다.** 그 문장이 **table 의 재료**를 지웠다 —
 *   결론 이해에 필요한 비교는 남기고, 증명용 source dump 만 Evidence 로 보낸다
 * - 🔴 **field 설명에서 형식 지시를 걷어냈다.** 여섯 칸이 각자 「bullet 으로」·「ordered list 로」를
 *   지시하고 있었다. field 설명은 작성 시점에 가장 가까이 붙어 **전역 규칙을 이긴다** — 대응표를
 *   아무리 넓혀도 그 칸들은 계속 자기 template 을 따랐다. 형식의 정본은 이제 한 곳뿐이다
 *
 * 🔴 **구조를 «몇 개 써라»로 바꾸지 않았다.** 그러면 장식이 늘 뿐이다. 정하는 것은 언제나 관계다.
 *
 * 우선순위: correctness > evidence > causality > **information hierarchy** > readability > formatting.
 */
export const NARRATIVE_MARKDOWN =
  "Review Knowledge는 나중에 다시 읽어도 지식으로 쓸 수 있는 «하나의 기술 문서»다 — Issue 하나가 문서 하나이고, 각 field는 그 문서 안의 chapter다. " +
  "빠르게 훑히는 것은 그 문서를 읽는 방식이지 목표가 아니다. 우선순위는 correctness > evidence > causality > information hierarchy > readability > formatting이다. " +
  "🔴 긴 문단 두셋으로만 끝내지 않는다(paragraph wall 금지). " +
  "한 field 안에 서로 다른 논점이 둘 이상이면 그 내용에 맞는 subheading으로 나눈다 — " +
  "🔴 heading은 개념 라벨이 아니라 그 자리의 원인·변경을 지목하는 문장으로 쓴다 " +
  "— 예: «`baseHeadingLevel` 기본값이 부모 계층을 무시한다»·«누락된 prop을 검출하는 검증이 없다». " +
  "«직접 원인»·«구조적 문제»·«영향 범위» 같은 일반 라벨을 template처럼 늘어놓지 않는다. " +
  "🔴 무엇을 쓸지 정하기 «전에» 전달하려는 정보 사이의 관계를 먼저 판단하고, 그 관계를 가장 명확하게 드러내는 구조를 고른다 — Markdown 문법을 쓰는 것 자체가 목표가 아니다. " +
  "독립된 semantic topic은 heading, 설명·원인·인과는 paragraph, 병렬적인 사실·조건·영향·선택지는 unordered list, 시간·실행·실패·상태 전이 순서는 ordered list, 상위 항목과 세부의 관계는 nested list, " +
  "여러 대상의 «같은 속성» 비교는 table, 문서 전체에서 기억해야 할 핵심 판단·제약·주의는 blockquote, component·function·prop·상태·설정 key 같은 identifier는 inline code, " +
  "실제 코드가 prose보다 짧고 명확하게 메커니즘을 보여 줄 때는 fenced code block이다. " +
  "🔴 한 Issue에서 이 구조를 전부 쓸 필요는 없다. 내용의 관계상 그 구조가 prose보다 명확할 때만 쓰고, 문서를 보기 좋게 하려고 억지로 넣지 않는다 — 반대로 여러 종류의 정보가 있는데 전부 paragraph로만 쓰지도 않는다. " +
  "🔴 문단은 글자 수·줄 길이·화면 폭이 아니라 semantic role로 나눈다 — 한 문단에 핵심 역할 하나. 하나의 인과가 자연스럽게 이어지면 쪼개지 말고 문단으로 두고, 사실 하나뿐인 짧은 내용은 문단 하나가 가장 좋다. " +
  "«하지만·반면·그러나·실제로·결과적으로·따라서·다만·문제는·중요한 점은» 은 논리 전환 신호일 뿐이다 — 낱말을 봤다고 줄바꿈하지 말고 실제로 역할이나 관점이 바뀔 때만 새 문단으로 간다. " +
  "🔴 heading은 `#`에서 시작하고 그 아래 세부가 `##`다 — field 안에서의 «상대 깊이»를 쓴다. 실제 DOM 단계는 이 문서가 화면의 어느 자리에 얹히는지가 정하므로, 화면 제목과 겹칠 걱정을 하지 않아도 된다. " +
  "핵심 판단·중요한 구분에는 bold를 쓴다 — 한 section에 하나둘이면 충분하고 문장 전체를 칠하지 않는다. " +
  "🔴 bold를 heading 대신 쓰지 않는다 — 줄 하나를 통째로 `**소제목**` 으로 세우면 굵은 글자일 뿐 문서 구조가 아니라서, 목차로 잡히지 않고 훑는 눈에도 층이 생기지 않는다. topic이 갈리는 자리는 heading이고 bold는 그 안의 강조다. " +
  "🔴 각 field는 독립된 답이 아니라 «앞 field가 세운 사실을 전제로 다음 논리 단계로 나아가는 자리»다 — 앞에서 설명한 것을 다음 field에서 처음부터 다시 설명하지 않는다. " +
  "description은 관찰되는 현상과 왜 문제인지로 문서를 열고, rootCause는 그것을 되풀이하지 말고 technical cause와 그 cause가 현상을 만드는 이유로 바로 진행하고, " +
  "failurePath는 원인을 prose로 다시 풀지 말고 실제 실행 순서·상태 변화·재현 과정을 보이고, suggestion은 원인을 다시 강의하지 말고 앞서 확립된 원인을 전제로 수정 방향과 필요한 검증을 적고, " +
  "resolutionSummary와 Decision Record는 finding을 다시 요약하지 말고 실제로 무엇을 적용했고 왜 그것을 골랐고 어떻게 검증했고 어떤 trade-off·residual risk가 남았는지를 남긴다. " +
  "🔴 이 흐름은 고정 template이 아니다 — finding의 성격상 필요 없는 단계는 생략한다. 중요한 것은 순서가 아니라 field 사이에 정보 책임이 겹치지 않는 것이다. " +
  "처음 보는 개발자가 heading과 첫 문장만 읽고 «어떤 코드·계약이 왜 잘못됐는지» 말할 수 있어야 한다 — 해석해야 이해되면 실패다. " +
  "🔴 결론을 이해하는 데 필요한 «비교»와 검증된 값은 문서에 남긴다 — 그 관계에 맞는 구조로 두고 Evidence로 밀어내지 않는다. " +
  "검증 과정에서 나온 값을 전부 담지 않을 뿐이고, 판단을 뒷받침하지 않는 증명용 source detail만 Evidence의 몫이다. " +
  "🔴 원인을 특정하는 technical identifier(component·prop·함수·설정 key·상태 이름)는 «적극적으로» 쓴다 — 그것이 원인을 가장 짧고 정확하게 지목한다. " +
  "«특정한 맥락»·«통로»·«장치가 비어 있다»·«둘이 형제가 된다» 처럼 다시 해석해야 이해되는 추상 표현으로 바꾸지 않는다. 은유·수사·돌려 말하기 금지, 한 문장에 하나의 판단. " +
  "🔴 숨기는 것은 identifier가 아니라 «source dump»다 — 긴 JSX 조각·className 문자열·CSS 속성값 나열·정확한 source expression은 narrative의 주인공이 아니고 그 자리는 Code Evidence다. " +
  "둘은 다른 규칙이다: `MarkdownView`·`baseHeadingLevel`·`Section`은 쓰고, className이 박힌 JSX 한 줄은 Evidence로 보낸다. " +
  "file·function·class·method·symbol·config key·package·branch·commit·HTTP status·SQLSTATE·command 같은 technical identifier는 inline code로 표시한다. " +
  "heading 하나에 한 문장 같은 빈 ceremony는 만들지 않는다. " +
  "금지: 모든 field에 같은 heading template을 쓰는 것, 내용과 무관하게 늘 같은 소제목 묶음을 생성하는 것, field 이름을 heading으로 되풀이하는 것(UI가 이미 그린다), " +
  "모든 문장을 bullet로 바꾸는 것, 의미 없는 heading, 과도한 bold, bold 한 줄을 heading 대신 세우는 것, 장식을 위한 Markdown, " +
  "관계와 무관하게 구색으로 넣는 table·blockquote·code block, 앞선 Issue의 좋은 문구를 다음 Issue에 그대로 복사하는 것, " +
  "글자 수 N자마다 강제로 개행하는 것, 화면 폭을 예상해 줄을 끊는 것, 문장 중간의 `<br>`, " +
  "모든 문장을 각각 문단으로 만드는 것, 접속사마다 기계적으로 문단을 나누는 것, " +
  "heading 바로 아래 같은 문구를 되풀이하는 것, 원인 한 줄 + 수정 한 줄짜리 메모로 축소하는 것, paragraph wall, raw HTML.";

/**
 * 각 field 설명에 붙는 «한 줄». 전체 규칙은 server instructions 가 갖는다.
 *
 * 🔴 field 설명은 그 칸이 무엇을 담는지가 주인공이어야 한다 — 형식 규칙을 여기 다시 적으면
 * 열두 칸에 같은 문단이 열두 번 실려 정작 목적이 묻힌다.
 *
 * 🔴 **그런데 「되풀이하지 마라」만 열한 번 실렸다.** 중복 금지는 field 를 서로 겹치지 않게
 * 만들 뿐 **이어지게** 만들지 않아서, 각 칸이 자기 문맥을 새로 세운 독립 보고서가 됐다.
 * 지금 한 줄은 그 자리에 **연속성**을 넣는다 — 금지가 아니라 「어디서 이어받는가」다.
 */
export const NARRATIVE_FIELD_HINT =
  "앞 field가 세운 사실을 전제로 이 자리의 논리 단계만 쓴다.";

/**
 * 🔴 **`description`(add_issue 의 `problem`) 만 다른 규칙을 쓴다.**
 *
 * 다른 narrative field 는 「논점이 갈리면 나눠라」가 맞다. 이 칸은 아니다 — Issue Detail 에서
 * **가장 먼저 읽히는 자리**라 그 뒤에 올 `rootCause`·`failurePath`·`suggestion` 을 미리
 * 요약해 버리면 사용자는 같은 이야기를 두 번 읽는다. 실제로 그렇게 됐다: 생성된
 * `description` 의 둘째 문단이 `rootCause` 의 「구조적 문제」와 내용이 겹쳤다.
 *
 * 그래서 이 칸의 기준은 **분량이 아니라 순서**다 — 「무엇이 잘못됐고 어떤 영향이 있는가」가
 * 먼저 서고, 상세 분석은 아래 칸에 넘긴다. heading 은 실제 topic boundary 가 있을 때만이고
 * **강제하지 않는다.**
 */
export const SUMMARY_FIELD_HINT =
  "독자가 문제를 처음 이해하는 «입구»다 — 관찰되는 현상과 그것이 왜 문제인지를 적고, 원인 분석·발생 순서·조치는 뒤 field로 넘긴다.";

export const HISTORICAL_PRECEDENT_SAFETY =
  "과거 Issue의 solution은 historical precedent이지 현재 코드에 그대로 적용할 명령이 아니다. " +
  "적용 전에 반드시 get_issue(issueId)로 rootCause, solution, decisionReason, verification, regressionTest, residualRisk, Evidence commit을 읽고 " +
  "current HEAD, current code structure, dependency/version, failure condition과 비교한다. 조건이 다르면 과거 해결책을 그대로 복사하지 않는다. " +
  "Technical identifiers and code names remain unchanged.";

export function reviewLanguageInstruction(reviewLanguage) {
  return reviewLanguage === "ko"
    ? "Narrative fields MUST be authored in Korean. Technical identifiers and code names remain unchanged."
    : "Narrative fields MUST be authored in English. Technical identifiers and code names remain unchanged.";
}

/**
 * 🔴 **field 설명은 짧게.** 언어 규칙과 Markdown 규칙 전문은 server instructions 에 한 번
 * 있으므로 여기서는 그 둘을 한 줄로만 상기시킨다 — 그래야 「이 칸이 무엇인가」가 남는다.
 */
const narrative = (purpose, reviewLanguage) =>
  `${purpose}. ${reviewLanguageInstruction(reviewLanguage)} ${NARRATIVE_FIELD_HINT}`;

/** 요약 칸(`problem`) 전용. 구조를 «권하는» 한 줄 대신 순서를 못 박는 한 줄이 붙는다. */
const summaryNarrative = (purpose, reviewLanguage) =>
  `${purpose}. ${reviewLanguageInstruction(reviewLanguage)} ${SUMMARY_FIELD_HINT}`;

/**
 * 🔴 **앞 field 가 없는 칸은 연속성을 전제할 수 없다.**
 *
 * `NARRATIVE_FIELD_HINT` 는 한 Issue 안에서 **순서를 갖는 chapter** 를 위한 줄이다.
 * 그런데 `create_review.summary` 는 Review 의 유일한 서술이고, Activity 요약 둘은
 * History 타임라인에서 **한 줄씩 따로** 읽힌다 — 전제할 앞 field 가 없다.
 *
 * 그 칸에 연속성을 요구하면 Agent 가 있지도 않은 앞 문맥을 전제해 배경을 생략하고,
 * 그 요약만 보이는 화면에서 문서가 자립하지 못한다.
 */
export const STANDALONE_FIELD_HINT =
  "이 칸은 앞뒤 field 없이 «단독으로» 읽히는 자리다 — 이 한 칸만 보고도 무엇을 했고 무엇이 달라졌는지 알 수 있게 쓴다.";

const standaloneNarrative = (purpose, reviewLanguage) =>
  `${purpose}. ${reviewLanguageInstruction(reviewLanguage)} ${STANDALONE_FIELD_HINT}`;

export const EVIDENCE_COMMIT_CONTRACT =
  "이 snapshot 이 «실제로 존재하는» commit SHA. " +
  "🔴 아직 커밋하지 않은 코드라면 이 근거를 보내지 말고 커밋한 뒤에 붙여라 — " +
  "HEAD 를 적으면 그 commit 에 없는 코드를 가리켜 검증이 MISMATCH 로 남는다.";

const evidenceItem = z.object({
  kind: z
    .enum(["BEFORE", "AFTER"])
    .describe("BEFORE = 문제가 있던 코드, AFTER = 고친 뒤의 코드"),
  /**
   * 🔴 **HEAD 를 습관적으로 적지 마라.**
   *
   * 서버는 이 SHA 로 GitHub 을 읽어 snapshot 과 글자 단위로 대조한다. 아직 커밋하지 않은
   * 코드를 snapshot 으로 보내면서 `commitSha` 에 HEAD 를 적으면, **그 commit 에는 그 코드가
   * 없으므로 대조는 정직하게 실패하고 근거가 `MISMATCH` 로 남는다** — 실제로 그렇게 쌓인
   * 근거가 있었다. 「수정이 실패했다」는 뜻이 아니라 **가리킨 좌표에 그 코드가 없다**는 뜻이다.
   */
  commitSha: z.string().describe(EVIDENCE_COMMIT_CONTRACT),
  filePath: z.string().describe("저장소 루트 기준 경로"),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "snapshot 첫 줄. 문제·수정 line과 필요한 최소 context로 범위를 좁힌다",
    ),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "snapshot 마지막 줄. 전체 함수/컴포넌트를 습관적으로 포함하지 않는다",
    ),
  snapshot: z
    .string()
    .optional()
    .describe(
      "그 줄 범위의 실제 코드. 문제·수정 line과 이해에 필요한 소량의 context만 포함한다. 전체 함수/컴포넌트를 습관적으로 보내지 않는다. 서버가 GitHub에서 대조해 확인 여부를 따로 기록한다.",
    ),
});

function decisionFields(reviewLanguage) {
  const describeNarrative = (purpose) => narrative(purpose, reviewLanguage);
  return {
  solution: z
    .string()
    .optional()
    .describe(
      describeNarrative(
        "실제로 무엇을 적용했는가. 고른 이유·버린 대안·감수한 비용은 아래 칸이 따로 받는다",
      ),
    ),
  decisionReason: z
    .string()
    .optional()
    .describe(
      describeNarrative(
        "왜 «그것을» 골랐는가. 대안 설명이 아니라 이 선택을 하게 만든 근거다 — alternativesConsidered 와 겹쳐 적지 않는다",
      ),
    ),
  alternatives: z
    .string()
    .optional()
    .describe(
      describeNarrative(
        "무엇을 함께 검토했고 왜 버렸는가",
      ),
    ),
  tradeOff: z
    .string()
    .optional()
    .describe(
      describeNarrative(
        "그 선택으로 «무엇을 내주었는가». 장점 목록이 아니라 감수하기로 한 비용·제약이다",
      ),
    ),
  verification: z
    .string()
    .optional()
    .describe(
      describeNarrative(
        "고쳐졌음을 어떻게 확인했는가 — 무엇을 돌렸고 무엇이 달라졌는지",
      ),
    ),
  regressionTest: z
    .string()
    .optional()
    .describe(describeNarrative("다시 무너지는 것을 무엇이 막는가")),
  residualRisk: z
    .string()
    .optional()
    .describe(
      describeNarrative(
        "그래도 남아 있는 위험 — 없는 위험을 만들지 않는다",
      ),
    ),
  };
}

/** Tool 인자의 판단 칸을 API 계약의 이름으로 옮긴다. 전부 비면 보내지 않는다. */
function toDecision(args) {
  const record = {
    solution: args.solution,
    decisionReason: args.decisionReason,
    alternativesConsidered: args.alternatives,
    tradeOff: args.tradeOff,
    verification: args.verification,
    regressionTest: args.regressionTest,
    residualRisk: args.residualRisk,
  };
  return Object.values(record).some((v) => v !== undefined)
    ? record
    : undefined;
}

function toEvidence(args) {
  return (args.evidence ?? []).map((item) => ({
    kind: item.kind,
    commitSha: item.commitSha,
    filePath: item.filePath,
    startLine: item.startLine ?? null,
    endLine: item.endLine ?? null,
    snapshot: item.snapshot ?? null,
  }));
}

/**
 * 근거마다 **좌표의 성격**을 로컬 git 으로 확인해 붙인다(`sourceState`).
 *
 * 🔴 **Agent 에게 묻지 않는다.** 「이 코드가 그 commit 에 있느냐」는 사람의 기억이 아니라
 * git 이 아는 사실이고, Agent 는 고친 직후라 늘 HEAD 를 적는다 — 그래서 아직 커밋하지
 * 않은 AFTER 근거가 서버에서 구조적으로 `MISMATCH` 로 남았다. 물어보는 대신 **본다.**
 *
 * 🔴 **다른 저장소의 근거에는 저절로 붙지 않는다.** 판정이 `commitSha` 에 매여 있기
 * 때문이다 — 로컬에 없는 commit 이면 `git show` 가 실패해 `null` 이 나온다. 그래서
 * `repository` 를 명시해 다른 저장소를 가리킨 요청은 조용히 지나간다.
 *
 * 🔴 **판정하지 못하면 아무것도 붙이지 않는다** — 서버 기본값 `COMMITTED` 로 가서 지금까지와
 * 똑같이 대조된다. 확인 못 한 것을 「커밋 전」으로 넘기면 진짜 불일치가 숨는다.
 */
async function withSourceState(args) {
  const evidence = toEvidence(args);
  if (evidence.length === 0) return evidence;

  return Promise.all(
    evidence.map(async (item) => {
      const sourceState = await classifyEvidenceSource(process.cwd(), item);
      return sourceState === null ? item : { ...item, sourceState };
    }),
  );
}

/** Agent 이름. 무엇이 남겼는지 History 에서 갈라 보려면 이것이 필요하다(스펙 17). */
const actorName = z
  .string()
  .optional()
  .describe("이 기록을 남기는 Agent 이름 (예: claude-code, codex)");

export function registerTools(
  server,
  client,
  state,
  { reviewLanguage = "en" } = {},
) {
  const describeNarrative = (purpose) => narrative(purpose, reviewLanguage);
  const describeSummary = (purpose) => summaryNarrative(purpose, reviewLanguage);
  const describeStandalone = (purpose) =>
    standaloneNarrative(purpose, reviewLanguage);
  const decision = decisionFields(reviewLanguage);
  /** 🔴 Repository 를 사람에게 묻지 않는다 — git remote 가 정본이다(스펙 7). */
  async function resolveRepository(fullName) {
    if (typeof fullName === "string" && fullName.trim() !== "") {
      return repositoryFromFullName(fullName);
    }
    try {
      return await readRepositoryContext();
    } catch {
      throw new ToolError(
        "현재 git remote에서 GitHub Repository를 읽지 못했습니다. repository에 owner/name을 명시하세요.",
      );
    }
  }

  server.registerTool(
    "create_review",
    {
      title: "Review 시작",
      description:
        "이 저장소의 Code Review 한 번을 ReviewTrace 에 연다. " +
        "저장소와 commit 은 현재 git 저장소에서 자동으로 읽는다. " +
        "문제를 찾을 때마다 add_issue 로 이 Review 에 붙인다.",
      inputSchema: {
        summary: z
          .string()
          .optional()
          .describe(describeStandalone("이번 Review 가 무엇을 봤는지 한두 줄")),
        reviewer: actorName,
        repository: z
          .string()
          .optional()
          .describe(
            "거의 항상 생략한다 — 현재 git 저장소의 origin 에서 자동으로 읽는다. " +
              "지금 열려 있지 않은 «다른» 저장소를 기록할 때만 owner/name 을 넣어라. 추측해서 채우지 마라.",
          ),
        commitSha: z
          .string()
          .optional()
          .describe("거의 항상 생략한다 — 현재 HEAD 를 자동으로 읽는다"),
        project: z
          .string()
          .optional()
          .describe(
            "이 Review 가 들어갈 기존 Project 의 slug. Repository가 이미 연결되어 있으면 생략한다. " +
              "미등록 Repository라면 반드시 넣어야 하며, GitHub App 접근권한을 확인한 뒤 연결된다.",
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        const repo = await resolveRepository(args.repository);
        const commitSha = args.commitSha ?? repo.commitSha;

        const result = await client.createReview(
          {
            project:
              typeof args.project === "string" && args.project.trim() !== ""
                ? { slug: args.project.trim(), name: null }
                : null,
            repository: {
              provider: repo.provider,
              owner: repo.owner,
              name: repo.name,
              fullName: repo.fullName,
              defaultBranch: repo.defaultBranch,
              htmlUrl: repo.htmlUrl,
            },
            target: {
              type: commitSha === null ? "REPOSITORY" : "COMMIT",
              branch: repo.branch,
              commitSha,
              changedFiles: repo.changedFiles ?? [],
            },
            reviewer: { type: "AGENT", name: args.reviewer ?? "unknown-agent" },
            summary: args.summary ?? null,
            issues: [],
          },
          /**
           * 같은 Review 를 두 번 열지 않게 하는 열쇠.
           *
           * 🔴 **성공할 때까지 같은 열쇠를 들되, «그 요청»에만 쓴다.** 서버가 저장한 뒤
           * 응답만 잃으면 이 Tool 은 실패로 끝난다 — 다음 호출에서 열쇠를 새로 만들면
           * 같은 Review 가 하나 더 저장된다. 그렇다고 열쇠를 무조건 물려주면 더 나쁘다:
           * **다른 commit 으로 연 Review 가 앞선 Review 의 replay 로 접혀**, 이어지는
           * `add_issue` 가 엉뚱한 세션에 붙는다. 그래서 열쇠는 저장소+commit 에 묶인다.
           */
          reviewKeyFor(state, `${repo.fullName}@${commitSha ?? ""}`),
          repo.workspaceSlug,
        );

        /**
         * 🔴 방금 연 Review 를 기억한다 — Agent 가 id 를 들고 다니지 않게(스펙 6).
         *
         * 🔴 **`lastIssueId` 를 반드시 비운다.** 안 비우면 Review A 에서 다루던 Issue 가
         * Review B 를 연 뒤에도 남아, `issueId` 를 생략한 `resolve_issue` 가
         * **엉뚱한 Issue 를 닫는다.** 「생략하면 마지막으로 다룬 것」이라는 편의가
         * 바로 그 자리에서 사고가 된다.
         */
        state.reviewId = result.reviewSessionId;
        state.lastIssueId = null;
        // encounter 도 Review 단위다 — 앞 Review 의 기록이 다음 Review 를 접지 않게 비운다.
        state.encounteredIssueIds = new Set();
        // 열쇠는 «성공한 뒤에만» 비운다.
        state.pendingReviewKey = null;
        state.pendingReviewFingerprint = null;

        return {
          reviewId: result.reviewSessionId,
          repository: repo.fullName,
          commitSha,
          branch: repo.branch,
          knowledgePreflight: result.knowledgePreflight ?? null,
          /**
           * 🔴 **바뀐 파일을 «못 읽은» 것과 «없는» 것을 구분해 알린다.**
           *
           * `readChangedFiles` 가 실패하면(`maxBuffer` 초과·timeout·git 없음) 빈 목록이
           * 나가는데, 서버는 그것을 「바뀐 파일이 0개」로 받아 `available: true` 로 답한다.
           * 그러면 Agent 는 **지금 고치는 파일과 무관한 Knowledge 후보**를 받고 그것을
           * 「관련 이력이 없다」로 읽는다.
           *
           * 서버가 이미 「Review 는 됐지만 Knowledge 를 못 읽었다」를
           * `knowledgePreflight.available: false` 로 구분해 두었으므로(`route.ts`),
           * client 쪽에도 같은 구분이 있어야 짝이 맞는다.
           */
          ...(repo.changedFilesAvailable === false
            ? {
                changedFiles경고:
                  "이 저장소의 바뀐 파일 목록을 읽지 못했다(git 출력 상한·timeout 등). 아래 Knowledge 후보는 바뀐 파일을 반영하지 않은 것이니, 관련 이력이 없다고 단정하지 말고 get_repository_knowledge 나 search_issues 로 직접 찾아라.",
              }
            : {}),
          Knowledge안내:
            "후보를 적용하기 전에 get_issue(issueId)로 전체 판단과 Evidence commit을 읽고 현재 코드와 다시 비교한다.",
          다음: "문제를 찾을 때마다 add_issue 를 부른다. reviewId 는 생략해도 된다.",
        };
      }),
  );

  server.registerTool(
    "add_issue",
    {
      title: "발견한 문제 기록",
      description:
        "Review 에서 찾은 문제 하나를 기록한다. " +
        "중요한 문제라면 rootCause 와 Evidence(BEFORE) 를 함께 남긴다 — " +
        "증상만 쌓이면 다음 Review 에서 다시 쓸 것이 없다. " +
        "alreadyKnown=true이고 currentStatus=RESOLVED인데 문제가 실제로 다시 존재하면 " +
        "review_again(stillPresent=true)를 호출해 명시적으로 다시 연다.",
      inputSchema: {
        reviewId: z
          .string()
          .optional()
          .describe("생략하면 이 세션에서 마지막으로 연 Review"),
        severity,
        category,
        title: z
          .string()
          .describe(
            `한 줄 제목. ${reviewLanguageInstruction(reviewLanguage)}`,
          ),
        problem: z
          .string()
          .optional()
          .describe(
            describeSummary(
              "관찰되는 현상과 그것이 왜 문제인가",
            ),
          ),
        rootCause: z
          .string()
          .optional()
          .describe(
            describeNarrative(
              "구체적인 technical cause 와 그것이 현상을 만드는 이유",
            ),
          ),
        failurePath: z
          .string()
          .optional()
          .describe(
            describeNarrative(
              "문제가 실제로 발생하는 순서·상태 변화·재현 과정 (보안이면 공격 경로)",
            ),
          ),
        patternKey: z
          .string()
          .optional()
          .describe("반복되는 문제의 정규화된 이름 (예: N_PLUS_ONE)"),
        filePath: z.string().optional(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        suggestion: z
          .string()
          .optional()
          .describe(
            describeNarrative(
              "앞서 확립된 원인을 전제로 한 수정 방향과 필요한 검증",
            ),
          ),
        tags: z.array(z.string()).optional(),
        externalId: z
          .string()
          .optional()
          .describe(
            "같은 문제를 다시 보고할 때 쓰는 너의 식별자. 넣으면 행이 늘지 않고 History 가 이어진다.",
          ),
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        const reviewId = args.reviewId ?? state.reviewId;
        if (reviewId === null || reviewId === undefined) {
          throw new ToolError(
            "열려 있는 Review 가 없다. 먼저 create_review 를 부르거나 reviewId 를 넣어라.",
          );
        }

        const result = await client.appendIssues(reviewId, [
          {
            severity: args.severity,
            category: args.category,
            title: args.title,
            description: args.problem ?? null,
            rootCause: args.rootCause ?? null,
            failurePath: args.failurePath ?? null,
            patternKey: args.patternKey ?? null,
            filePath: args.filePath ?? null,
            startLine: args.startLine ?? null,
            endLine: args.endLine ?? null,
            suggestion: args.suggestion ?? null,
            tags: args.tags ?? [],
            source: "mcp",
            externalId: args.externalId ?? null,
            decision: toDecision(args),
            evidence: await withSourceState(args),
          },
        ]);

        const issue = result.issues[0];
        state.lastIssueId = issue?.id ?? state.lastIssueId;
        // 기존 행을 다시 만났으면 서버가 이번 Review 의 `REVIEWED_AGAIN` 을 이미 남겼다.
        if (issue?.alreadyKnown === true) markEncounter(state, issue.id);

        return {
          issueId: issue?.id ?? null,
          alreadyKnown: issue?.alreadyKnown ?? false,
          currentStatus: issue?.currentStatus ?? issue?.status ?? null,
          안내:
            issue?.alreadyKnown === true &&
            (issue.currentStatus ?? issue.status) === "RESOLVED"
              ? "해결됐던 기존 문제다. 현재 Review에서도 실제로 존재한다면 review_again(stillPresent=true)를 호출해 REOPENED로 전환해야 한다."
              : issue?.alreadyKnown === true
                ? "이미 알고 있던 문제다. 새 행을 만들지 않고 History 에 다시 만났다고 남겼다."
              : "새 문제로 기록했다.",
        };
      }),
  );

  server.registerTool(
    "add_fix_attempt",
    {
      title: "고침 시도 기록",
      description:
        "이 문제를 이렇게 고쳐 봤다는 기록을 남긴다. " +
        "무엇을 왜 골랐는지와 AFTER Evidence 를 함께 남긴다 — " +
        "다음 시도가 이 판단을 덮어쓰지 않고 나란히 쌓인다.",
      inputSchema: {
        issueId: z
          .string()
          .optional()
          .describe("생략하면 마지막으로 다룬 Issue"),
        summary: z.string().optional().describe(describeStandalone("고침 시도의 요약")),
        commitSha: z.string().optional().describe("고친 commit"),
        actor: actorName,
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(() =>
        activity(client, state, args, "FIX_ATTEMPTED", "고침 시도를 기록했다."),
      ),
  );

  server.registerTool(
    "review_again",
    {
      title: "다시 검토한 결과 기록",
      description:
        "고쳐졌다고 한 것을 다시 봤다는 기록을 남긴다. " +
        "문제가 아직 남아 있으면 stillPresent 를 true 로 준다 — 닫혀 있던 Issue 가 다시 열린다. " +
        "검증까지 통과했으면 resolve_issue 를 부른다.",
      inputSchema: {
        issueId: z.string().optional(),
        summary: z.string().optional().describe(describeStandalone("다시 본 결과")),
        stillPresent: z
          .boolean()
          .optional()
          .describe(
            "다시 봤더니 문제가 그대로 있는가. true 면 Issue 를 REOPENED 로 되돌린다.",
          ),
        commitSha: z.string().optional(),
        actor: actorName,
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        if (args.stillPresent !== true) {
          const reviewed = await activity(
            client,
            state,
            args,
            "REVIEWED_AGAIN",
            "재검토를 기록했다.",
          );
          markEncounter(state, reviewed.issueId);
          return reviewed;
        }

        /**
         * 🔴 **상태를 «먼저» 옮긴다.**
         *
         * 두 번의 요청이라 사이에서 끊길 수 있다. 「아직 남아 있다」를 History 에만 적고
         * 상태가 `RESOLVED` 로 남으면, 다시 무너진 문제가 미해결 조회에서 사라져
         * **아무도 못 본다.** 반대로 상태만 옮기고 encounter 한 줄이 빠지면, 열려 있는
         * Issue 의 반복 횟수가 하나 모자랄 뿐이다 — 그쪽이 덜 위험하다.
         *
         * 판단과 Evidence 는 `REOPENED` 전이가 가져간다. 그것이 이번에 내린 판단이다.
         */
        const issueId = requireIssue(state, args.issueId);

        const updated = await client.updateStatus(issueId, {
          status: "REOPENED",
          resolutionSummary: args.summary ?? null,
          commitSha: args.commitSha ?? null,
          actor: { type: "AGENT", name: args.actor ?? "unknown-agent" },
          decision: toDecision(args),
          evidence: await withSourceState(args),
        });
        state.lastIssueId = issueId;

        /**
         * 🔴 **재발은 encounter 다 — 그런데 두 번 세지도 않는다.**
         *
         * `add_issue` 가 기존 행을 다시 만났으면 서버가 이번 Review 의 `REVIEWED_AGAIN` 을
         * 이미 남겼으므로 여기서 또 남기면 한 번의 재발이 둘이 된다. 반대로 `add_issue` 를
         * 거치지 않고(`externalId` 없이 보고했거나 `get_issue`·`search_issues` 로 찾은 Issue를
         * 바로 다시 연 경우) 곧장 들어오면 남긴 쪽이 아무도 없다 — 그러면 «실제로 다시 만난»
         * 것이 `encounters` 에서 통째로 빠진다. 이 Review 에서 아직 남지 않았을 때만 남긴다.
         */
        const alreadyCounted = hasEncounter(state, issueId);
        if (!alreadyCounted) {
          await client.addActivity(issueId, {
            type: "REVIEWED_AGAIN",
            actor: { type: "AGENT", name: args.actor ?? "unknown-agent" },
            description: args.summary ?? null,
            commitSha: args.commitSha ?? null,
          });
          markEncounter(state, issueId);
        }

        return {
          issueId,
          currentStatus: updated?.issue?.status ?? "REOPENED",
          안내: alreadyCounted
            ? "Issue 를 다시 열었다. add_issue 가 남긴 REVIEWED_AGAIN encounter 는 중복해서 기록하지 않았다."
            : "Issue 를 다시 열고 이번 Review 의 REVIEWED_AGAIN encounter 를 남겼다.",
        };
      }),
  );

  server.registerTool(
    "resolve_issue",
    {
      title: "해결로 닫기",
      description:
        "검증까지 끝난 문제를 닫는다. 어떻게 해결했는지(resolution)는 반드시 적는다 — " +
        "그것이 다음 Review 에서 다시 쓰이는 값이다.",
      inputSchema: {
        issueId: z.string().optional(),
        resolution: z.string().describe(describeNarrative("어떻게 해결했는가 (필수)")),
        commitSha: z.string().optional(),
        actor: actorName,
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        const issueId = requireIssue(state, args.issueId);
        const result = await client.updateStatus(issueId, {
          status: "RESOLVED",
          resolutionSummary: args.resolution,
          commitSha: args.commitSha ?? null,
          actor: { type: "AGENT", name: args.actor ?? "unknown-agent" },
          decision: toDecision(args),
          evidence: await withSourceState(args),
        });
        return { issueId, status: result.issue.status, 안내: "해결로 닫았다." };
      }),
  );

  server.registerTool(
    "get_issue",
    {
      title: "Issue 하나 읽기",
      description:
        "문제 하나를 History 까지 읽는다. 언제 발견됐고, 무엇을 해 봤고, 왜 그것을 골랐고, " +
        "무엇이 남았는지가 시간 순서로 나온다. repositoryFullName을 현재 git Repository와 " +
        "비교하고, 다르면 다른 Repository Knowledge라는 경고를 함께 반환한다. " +
        HISTORICAL_PRECEDENT_SAFETY,
      inputSchema: { issueId: z.string() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) =>
      guard(async () => {
        const result = await client.getIssue(args.issueId);
        /**
         * 🔴 **읽기는 「다음에 쓸 대상」을 정하지 않는다.**
         *
         * 예전에는 여기서 `state.lastIssueId` 를 args 로 덮었다. 그런데 이 Tool 의 설명이
         * 권하는 흐름이 바로 **과거 Issue 를 읽는 것**이다(`HISTORICAL_PRECEDENT_SAFETY`) —
         * 「지금 고치는 문제」와 「참고로 읽는 과거 문제」가 같은 칸을 쓰면 이렇게 된다:
         *
         * 1. `add_issue` 로 이번 문제를 만든다 — `lastIssueId` 는 그것이다.
         * 2. 계약대로 `get_repository_knowledge` 가 준 과거 후보를 `get_issue` 로 읽는다.
         * 3. 그 순간 `lastIssueId` 가 **과거 Issue** 로 바뀐다.
         * 4. 고친 뒤 `issueId` 를 생략하고 `resolve_issue` 를 부르면 **엉뚱한 과거 Issue 가 닫힌다.**
         *
         * `create_review` 는 같은 위험을 알고 `lastIssueId` 를 비우는데(그 자리 주석 참고)
         * 읽기 경계에는 그 보호가 없었다. 🔴 **읽었다고 대상이 바뀌지 않는다** —
         * 쓰기 Tool(`add_issue`·`add_fix_attempt`·`review_again`·`resolve_issue`)만 대상을 옮긴다.
         */
        let currentRepository = null;
        try {
          /**
           * 🔴 **여기서 필요한 것은 「지금 저장소가 어디인가」뿐이다.** 바뀐 파일 목록까지
           * 읽으면 git 을 두세 번 더 부르는데, Agent 는 후보마다 이 Tool 을 부른다.
           */
          currentRepository = await readRepositoryContext(process.cwd(), {
            includeChangedFiles: false,
          });
        } catch {
          // git context가 없는 곳에서도 ID 기반 read는 기존처럼 동작한다.
        }
        const issueRepository = result.issue?.repositoryFullName ?? null;
        const repositoryContextWarning =
          currentRepository !== null &&
          typeof issueRepository === "string" &&
          currentRepository.fullName.toLowerCase() !==
            issueRepository.toLowerCase()
            ? `현재 Repository는 ${currentRepository.fullName}이지만 이 Issue는 ${issueRepository}에 속합니다. 현재 Review Knowledge로 섞지 마세요.`
            : null;
        return { ...result.issue, repositoryContextWarning };
      }),
  );

  server.registerTool(
    "search_issues",
    {
      title: "Issue 찾기",
      description:
        "이 저장소에 지금 무엇이 열려 있는지, 또는 같은 Pattern 이 과거에 있었는지 찾는다. " +
        "코드를 고치기 전에 먼저 부르면 같은 문제를 두 번 만들지 않는다.",
      inputSchema: {
        repository: z
          .string()
          .optional()
          .describe("owner/name. 생략하면 현재 git 저장소"),
        status: z
          .enum([
            "OPEN",
            "IN_PROGRESS",
            "RESOLVED",
            "IGNORED",
            "FALSE_POSITIVE",
            "REOPENED",
          ])
          .optional(),
        severity: severity.optional(),
        category: category.optional(),
        patternKey: z.string().optional(),
        q: z
          .string()
          .optional()
          .describe("제목·파일 경로·Pattern 을 훑는 낱말"),
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) =>
      guard(async () => {
        const repo = await resolveRepository(args.repository);
        const repository = repo.fullName;
        const result = await client.searchIssues({
          repository,
          workspaceSlug: repo.workspaceSlug,
          status: args.status,
          severity: args.severity,
          category: args.category,
          patternKey: args.patternKey,
          q: args.q,
          limit: args.limit,
        });
        return { requestedRepository: repository, issues: result.issues };
      }),
  );

  server.registerTool(
    "get_repository_knowledge",
    {
      title: "이 저장소의 과거 Knowledge",
      description:
        "작업을 시작하기 전에 읽는다. 이 저장소에서 반복되는 Pattern, 아직 안 닫힌 문제, " +
        "과거에 어떻게 해결했는지가 나온다. 후보의 요약만으로 해결책을 적용하지 말고 " +
        "반드시 get_issue(issueId)로 전체 Decision Record와 Evidence commit을 읽는다. " +
        HISTORICAL_PRECEDENT_SAFETY,
      inputSchema: {
        repository: z
          .string()
          .optional()
          .describe("owner/name. 생략하면 현재 git 저장소"),
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) =>
      guard(async () => {
        const repo = await resolveRepository(args.repository);
        const repository = repo.fullName;
        const context = await client.knowledgeContext({
          repository,
          workspaceSlug: repo.workspaceSlug,
          limit: args.limit,
        });
        // local git 문자열은 requested일 뿐이다. DB resolution 여부는 서버의 scope가 말한다.
        return { requestedRepository: repository, ...context };
      }),
  );
}

async function activity(client, state, args, type, done) {
  const issueId = requireIssue(state, args.issueId);
  await client.addActivity(issueId, {
    type,
    actor: { type: "AGENT", name: args.actor ?? "unknown-agent" },
    description: args.summary ?? null,
    commitSha: args.commitSha ?? null,
    decision: toDecision(args),
    evidence: await withSourceState(args),
  });
  return { issueId, 안내: done };
}

/**
 * encounter 표시는 이 연결 동안의 기억일 뿐이다(`server.mjs` 의 `state`).
 * 시험처럼 Set 을 갖지 않은 state 로도 Tool 이 돌아야 하므로 여기서 채운다.
 */
function markEncounter(state, issueId) {
  if (issueId === null || issueId === undefined) return;
  if (!(state.encounteredIssueIds instanceof Set)) {
    state.encounteredIssueIds = new Set();
  }
  state.encounteredIssueIds.add(issueId);
}

function hasEncounter(state, issueId) {
  return (
    state.encounteredIssueIds instanceof Set &&
    state.encounteredIssueIds.has(issueId)
  );
}

function requireIssue(state, issueId) {
  const resolved = issueId ?? state.lastIssueId;
  if (resolved === null || resolved === undefined) {
    throw new ToolError(
      "대상 Issue 가 없다. issueId 를 넣거나 먼저 add_issue 로 하나를 만들어라. " +
        "get_issue 로 읽는 것은 대상을 옮기지 않는다 — 과거 Issue 를 참고로 읽었다가 그것을 닫는 사고를 막기 위해서다.",
    );
  }
  return resolved;
}

/**
 * 이 요청에 쓸 Idempotency-Key.
 *
 * 같은 저장소·commit 으로 다시 부르면 앞선 열쇠를 물려주고(서버가 replay 로 접는다),
 * 다른 대상이면 새로 만든다 — 물려주면 다른 Review 가 앞선 것으로 접힌다.
 */
function reviewKeyFor(state, fingerprint) {
  if (
    state.pendingReviewKey === null ||
    state.pendingReviewFingerprint !== fingerprint
  ) {
    state.pendingReviewKey = randomUUID();
    state.pendingReviewFingerprint = fingerprint;
  }
  return state.pendingReviewKey;
}

export class ToolError extends Error {}

/**
 * 실패를 Agent 가 읽을 수 있는 Tool 결과로 바꾼다(스펙 18).
 *
 * 🔴 **Stack 을 Tool 결과로 내보내지 않는다.** 우리가 뜻을 아는 오류만 문장으로 옮기고,
 * 모르는 것은 한 줄로 줄인다 — 원문은 stderr 로만 남는다.
 */
async function guard(run) {
  try {
    const value = await run();
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
  } catch (error) {
    const known =
      error instanceof ApiError ||
      error instanceof GitError ||
      error instanceof ToolError;

    if (!known) {
      console.error("[reviewtrace-mcp] 처리하지 못한 오류", error);
    }

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: known
            ? error.message
            : "ReviewTrace MCP 가 요청을 처리하지 못했다.",
        },
      ],
    };
  }
}
