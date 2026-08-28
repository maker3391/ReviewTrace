import { z } from "zod";

import { isStorableText } from "@/lib/validation/db-text";
import { normalizeSlug } from "@/lib/workspace/slug";

/**
 * Wiki 문서의 입력 계약(스펙 9).
 *
 * 🔴 **검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다. 여기에 둔다**(CLAUDE.md 9).
 * 화면(React Hook Form)과 Server Action 이 **같은 Schema 하나**를 본다.
 *
 * Markdown 원문을 그대로 저장한다 — Block Editor·협업 편집·자동 요약은 만들지 않는다(스펙 17).
 */

const TITLE_MAX = 200;
const SLUG_MAX = 60;
/**
 * 본문 상한.
 *
 * PostgreSQL `text` 자체에는 상한이 없다. 상한을 두는 이유는 검증이 아니라 **한 문서가
 * 쓸 수 있는 양을 정하기 위해서**다. 부딪히면 그때 올린다.
 */
const CONTENT_MAX = 100_000;

/**
 * slug 로 쓸 수 없는 이름.
 *
 * `/w/{ws}/knowledge/{slug}` 아래에 문서가 오고, 그 옆에 `new` 가 있다.
 * `new` 라는 slug 를 허용하면 작성 화면과 문서 주소가 겹친다.
 */
const RESERVED_SLUGS: readonly string[] = ["new", "edit"];

export const knowledgePageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "제목을 입력하세요.")
    .max(TITLE_MAX, `제목은 ${TITLE_MAX}자를 넘을 수 없습니다.`),
  slug: z
    .string()
    .trim()
    .max(SLUG_MAX, `slug 는 ${SLUG_MAX}자를 넘을 수 없습니다.`)
    .default(""),
  /**
   * Markdown 원문.
   *
   * 🔴 **붙여넣기로 들어오는 유일하게 긴 자유 입력이다.** 다른 곳에서 복사한 본문에는
   * `\u0000` 이나 깨진 Surrogate 가 섞여 들어올 수 있는데, PostgreSQL `text` 는 그것을
   * 받지 못한다 — Zod 가 통과시키면 Server Action 이 예외로 끝나고 화면은 이유를 말하지
   * 못한다(CLAUDE.md 8). Schema 에서 거절해야 폼이 「무엇이 잘못됐는지」를 보여 준다.
   *
   * Agent API 쪽 같은 문제는 `readJsonBody` 가 본문 하나로 훑는다(`lib/api/agent-route.ts`).
   * 여기는 Route 를 거치지 않는 경로라 그 그물에 걸리지 않는다.
   */
  content: z
    .string()
    .max(CONTENT_MAX, "본문이 너무 깁니다.")
    .refine(isStorableText, "본문에 저장할 수 없는 문자가 들어 있습니다.")
    .default(""),
});

/**
 * 🔴 **입력 타입과 출력 타입을 나눈다.** `.default("")` 이 붙은 필드는 넣을 때는 없어도
 * 되고 나올 때는 반드시 있다 — React Hook Form 은 앞을, Server Action 은 뒤를 다룬다.
 */
export type KnowledgePageFormValues = z.input<typeof knowledgePageSchema>;
export type KnowledgePageInput = z.output<typeof knowledgePageSchema>;

export interface ResolvedKnowledgePage {
  title: string;
  slug: string;
  content: string;
}

/**
 * 저장 직전의 값으로 좁힌다.
 *
 * 🔴 **정규화를 화면과 서버가 같은 함수로 한다**(`normalizeSlug`). 한쪽만 정규화하면
 * 사용자가 본 주소와 저장된 주소가 갈린다.
 */
export function resolveKnowledgePageInput(
  input: KnowledgePageInput,
): { ok: true; value: ResolvedKnowledgePage } | { ok: false; reason: string } {
  const slug = normalizeSlug(input.slug === "" ? input.title : input.slug);

  if (RESERVED_SLUGS.includes(slug)) {
    return {
      ok: false,
      reason: `'${slug}' 는 화면 주소로 쓰이는 이름이라 문서 slug 로 쓸 수 없습니다.`,
    };
  }

  return { ok: true, value: { title: input.title, slug, content: input.content } };
}
