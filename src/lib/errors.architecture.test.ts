import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { en } from "@/config/messages/en";
import { apiErrorFromUnknown, statusForErrorCode } from "@/lib/api/error-response";
import {
 APP_ERROR_REASONS,
 AppError,
 errorCodeForReason,
 type AppErrorReason,
} from "@/lib/errors";

/**
 * 값이 필요한 오류는 값과 함께 만든다. 시험이 전수를 돌기 위한 자리다.
 *
 * 🔴 **아래 캐스트는 TypeScript 의 한계를 비켜 가는 것일 뿐 판정을 느슨하게 하지 않는다.**
 * `AppErrorArgs` 는 reason 마다 tuple 하나씩으로 펼쳐지는데, 이름이 서른을 넘자 그 union
 * 을 더 풀지 못해 **union 을 그대로 넘기는 이 자리만** 타입 오류가 났다. 돌 때 넘어가는
 * 값은 언제나 진짜 `reason` 이라 이 시험이 확인하는 것(사전이 모든 오류를 덮는가 ·
 * code 가 언어를 따라 흔들리지 않는가)은 그대로다.
 *
 * 🔴 **`new AppError("한국어 문구")` 를 막는 보증은 이 캐스트와 무관하다** — 그것은
 * 부르는 자리마다 reason 을 «literal 로» 적기 때문에 지켜진다.
 */
function errorFor(reason: AppErrorReason): AppError {
 return reason === "PROJECT_SLUG_RESERVED" ||
 reason === "KNOWLEDGE_PAGE_SLUG_RESERVED"
 ? new AppError(reason, { meta: { slug: "new" } })
 : new AppError(reason as "UNEXPECTED");
}

/**
 * **의존 방향을 코드가 아니라 시험이 지킨다.**
 *
 * ```text
 * Presentation -> Application ✅
 * Application -> Presentation ❌
 * ```
 *
 * Application(Service · Schema)은 오류의 «의미»만 안다. 사전(`config/messages`)도,
 * 언어(`config/i18n`)도, 쿠키(`next/headers`)도, React 도 알지 못한다 — 알게 되는 순간
 * 오류 문구가 한 언어에 묶이고, 실제로 그랬을 때 EN 화면에 한국어가 그대로 떴다.
 *
 * 🔴 **문자열 검색 하나로 끝내지 않는다.** 한 파일이 직접 import 하지 않아도 **거쳐서**
 * 닿을 수 있다 — 아래는 `@/` 와 상대 경로를 실제로 따라가 **닿는 모든 모듈**을 본다.
 *
 * 🔴 **되돌림 확인(2026-08-29)**: `features/projects/server/project-service.ts` 에
 * `import { ko } from "@/config/messages/ko";` 한 줄을 넣자 ⑧ 이 그 파일을 지목하며
 * 실패했고, `lib/errors.ts` 에 `import { readLocale } from "@/lib/ui/appearance";` 를
 * 넣자 ⑨ 가 실패했다 — 둘 다 직접 돌려 봤고 되돌렸다.
 */

const SRC = resolve(import.meta.dirname, "..");

/** 화면의 말을 아는 모듈. Application 이 여기 닿으면 안 된다. */
const PRESENTATION = [
 "config/messages/ko.ts",
 "config/messages/en.ts",
 "config/i18n.ts",
 "lib/format/app-error.ts",
];

/** 「지금 누가 무슨 언어로 보고 있는가」를 아는 모듈·패키지. */
const REQUEST_SCOPED = [
 "lib/ui/appearance.ts",
 "lib/ui/locale-context.tsx",
 "lib/action/action-error.ts",
];
const REQUEST_SCOPED_PACKAGES = ["next/headers", "react", "react-dom"];

function listFiles(dir: string): string[] {
 if (!existsSync(dir)) {
 return [];
 }
 return readdirSync(dir).flatMap((entry) => {
 const full = join(dir, entry);
 return statSync(full).isDirectory() ? listFiles(full) : [full];
 });
}

/**
 * `from "…"` · `import "…"` 의 대상. 주석 안의 예시까지 걸리지만 그쪽이 안전하다.
 *
 * 파일 하나를 여러 진입점이 함께 거치므로 읽은 것을 기억한다 — 그러지 않으면 같은
 * 파일을 수십 번 다시 읽어 시험 전체가 느려지고, 옆에서 도는 무거운 시험이 시간을 잃는다.
 */
const SPECIFIER_CACHE = new Map<string, string[]>();

function specifiersOf(file: string): string[] {
 const cached = SPECIFIER_CACHE.get(file);
 if (cached !== undefined) {
 return cached;
 }

 const text = readFileSync(file, "utf8");
 const found: string[] = [];
 const pattern = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
 let match: RegExpExecArray | null;
 while ((match = pattern.exec(text)) !== null) {
 found.push(match[1] as string);
 }

 SPECIFIER_CACHE.set(file, found);
 return found;
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
 const base = specifier.startsWith("@/")
 ? join(SRC, specifier.slice(2))
 : specifier.startsWith(".")
 ? resolve(dirname(fromFile), specifier)
 : null;

 if (base === null) {
 return null;
 }

 for (const candidate of [
 `${base}.ts`,
 `${base}.tsx`,
 join(base, "index.ts"),
 join(base, "index.tsx"),
 ]) {
 if (existsSync(candidate)) {
 return candidate;
 }
 }
 return null;
}

/** 이 파일에서 «거쳐서라도» 닿는 모든 것. 저장소 안 파일과 밖 패키지를 함께 모은다. */
const REACHABLE_CACHE = new Map<
 string,
 { files: Set<string>; packages: Set<string> }
>();

function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
 const cached = REACHABLE_CACHE.get(entry);
 if (cached !== undefined) {
 return cached;
 }

 const files = new Set<string>();
 const packages = new Set<string>();
 const queue = [entry];

 while (queue.length > 0) {
 const file = queue.pop() as string;
 if (files.has(file)) {
 continue;
 }
 files.add(file);

 for (const specifier of specifiersOf(file)) {
 const resolved = resolveSpecifier(specifier, file);
 if (resolved === null) {
 if (!specifier.startsWith("@/") && !specifier.startsWith(".")) {
 packages.add(specifier);
 }
 continue;
 }
 queue.push(resolved);
 }
 }

 const result = { files, packages };
 REACHABLE_CACHE.set(entry, result);
 return result;
}

/** `src/` 기준 상대 경로. 실패 메시지가 읽히게 한다. */
function relative(file: string): string {
 return file.slice(SRC.length + 1).split(sep).join("/");
}

/**
 * Application Layer — 업무 판단이 사는 곳.
 *
 * Server Action(`actions/`)은 여기 넣지 않는다. 그쪽은 **Presentation 경계**라
 * 화면 언어를 알아야 하는 것이 맞다.
 */
const APPLICATION_FILES = [
...listFiles(join(SRC, "features")).filter((file) =>
 /[\\/](server|schemas)[\\/]/.test(file),
),
 join(SRC, "lib", "errors.ts"),
 join(SRC, "lib", "api", "error-response.ts"),
 join(SRC, "lib", "api", "agent-route.ts"),
 join(SRC, "lib", "api", "api-key-auth.ts"),
].filter((file) => !file.includes(".test."));

describe("Application -> Presentation 의존이 없다", () => {
 it("Application 이 하나라도 있다 — 목록이 비어서 통과하지 않는다", () => {
 expect(APPLICATION_FILES.length).toBeGreaterThan(20);
 });

 it("⑧ Application 이 사전(messages)에 닿지 않는다", () => {
 const offenders: string[] = [];

 for (const file of APPLICATION_FILES) {
 const { files } = reachable(file);
 for (const presentation of PRESENTATION) {
 if (files.has(join(SRC,...presentation.split("/")))) {
 offenders.push(`${relative(file)} -> ${presentation}`);
 }
 }
 }

 expect(offenders).toEqual([]);
 });

 it("⑨ Application 이 언어·쿠키·React 에 닿지 않는다", () => {
 const offenders: string[] = [];

 for (const file of APPLICATION_FILES) {
 const { files, packages } = reachable(file);
 for (const scoped of REQUEST_SCOPED) {
 if (files.has(join(SRC,...scoped.split("/")))) {
 offenders.push(`${relative(file)} -> ${scoped}`);
 }
 }
 for (const pkg of REQUEST_SCOPED_PACKAGES) {
 if (packages.has(pkg)) {
 offenders.push(`${relative(file)} -> ${pkg}`);
 }
 }
 }

 expect(offenders).toEqual([]);
 });

 /**
 * 🔴 **오류 계약 자체는 아무것도 끌고 오지 않는다.** `lib/errors.ts` 가 무언가를
 * import 하기 시작하면 그 무언가가 곧 Application 전체의 의존이 된다.
 */
 it("lib/errors.ts 는 아무것도 import 하지 않는다", () => {
 expect(specifiersOf(join(SRC, "lib", "errors.ts"))).toEqual([]);
 });
});

describe("⑩ Agent API 응답은 화면 언어를 타지 않는다", () => {
 /**
 * 🔴 **기계가 읽는 계약이 쿠키에 따라 흔들리면 안 된다**.
 * 보증은 정책이 아니라 **구조**다 — 이 길에는 언어를 받을 자리가 아예 없다.
 */
 it("응답을 만드는 길에 사전·쿠키가 없다", () => {
 const { files, packages } = reachable(
 join(SRC, "lib", "api", "error-response.ts"),
);

 for (const presentation of [...PRESENTATION,...REQUEST_SCOPED]) {
 expect(files.has(join(SRC,...presentation.split("/"))), presentation).toBe(
 false,
);
 }
 expect(packages.has("next/headers")).toBe(false);
 });

 /**
 * 🔴 **사전의 문구가 Agent 응답에 실리지 않는다.** 실리는 순간 「화면 언어를 바꿨더니
 * API 응답이 달라졌다」가 가능해진다 — 지금은 출처가 아예 다른 표다(`lib/errors.ts`).
 */
 it("어느 오류든 사전 문구가 아니라 고정 문구로 나간다", async () => {
 for (const reason of APP_ERROR_REASONS) {
 const response = apiErrorFromUnknown(errorFor(reason));
 const body = (await response.json()) as {
 error: { code: string; message: string };
 };

 expect(body.error.code, reason).toBe(errorCodeForReason(reason));
 expect(response.status, reason).toBe(
 statusForErrorCode(errorCodeForReason(reason)),
);
 expect(Object.keys(body.error), reason).toEqual(["code", "message"]);

 // 🔴 EN 사전의 문구가 응답에 실리는 길이 없다.
 const translated = en.errors[reason];
 expect(body.error.message, reason).not.toBe(
 typeof translated === "function" ? translated({ slug: "new" }) : translated,
);
 }
 });

 it("같은 오류는 언제 불러도 같은 본문이다", async () => {
 const once = await apiErrorFromUnknown(
 new AppError("KNOWLEDGE_PAGE_NOT_FOUND"),
).json();
 const twice = await apiErrorFromUnknown(
 new AppError("KNOWLEDGE_PAGE_NOT_FOUND"),
).json();

 expect(twice).toEqual(once);
 expect(once).toEqual({
 error: { code: "NOT_FOUND", message: "대상을 찾을 수 없습니다." },
 });
 });
});
