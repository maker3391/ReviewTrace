/**
 * Database 없이 **판정 규칙**만 시험하기 위한 최소 Fake.
 *
 * ## 왜 필요한가
 *
 * 실제 PostgreSQL 을 쓰는 시험(`*.integration.test.ts`)은 기본 `pnpm test` 에서 건너뛴다.
 * 그래서 「폐기된 Key 를 거절한다」처럼 **매번 돌아야 할 판정 규칙**이 정작 기본 실행에서
 * 안 도는 일이 생긴다 — `src/lib/api/api-key-auth.test.ts` 가 그 문제를 Fake 하나로 풀었고,
 * 이 파일은 같은 방식을 여러 Application Service 가 함께 쓰도록 한 곳에 모은 것이다.
 *
 * ## 🔴 이것으로 증명할 수 «없는» 것
 *
 * - **조건절이 옳은가.** Fake 는 `where` 를 해석하지 않는다. Tenant 격리처럼 지키는 주체가
 *   SQL 조건인 것은 **반드시 통합시험**으로 남는다
 * - **제약이 실제로 걸려 있는가.** unique index · 부분 index · FK · Cascade
 * - **Transaction 격리·동시성.** `for("update")` 가 무엇을 잠그는지
 * - **SQL 집계의 정확성.** `count(*) filter (...)` 가 무엇을 세는지
 *
 * 여기서 보는 것은 오직 **「어떤 행을 돌려받았을 때 어떻게 판단하는가」** 다.
 *
 * ## 쓰는 법
 *
 * Database 를 부르는 순서대로 단계를 적고, 각 단계가 돌려줄 행을 준다.
 *
 * ```ts
 * const fake = fakeExecutor([selects([]), inserts([{ id: "w1" }]), inserts([])]);
 * await ensurePersonalWorkspace({ ... }, fake.executor);
 * expect(fake.calls[2]?.values?.role).toBe("OWNER");
 * ```
 *
 * 실제 호출이 적어 둔 단계와 종류가 다르거나 단계보다 많으면 **그 자리에서 터진다** —
 * 조용히 `undefined` 를 돌려주면 시험이 엉뚱한 이유로 통과한다.
 */

import type { SQLWrapper } from "drizzle-orm";

import type { DbExecutor } from "@/db";

export type FakeOpKind = "select" | "insert" | "update" | "delete" | "execute";

/** 실제로 일어난 Database 호출 하나. */
export interface FakeCall {
  kind: FakeOpKind;
  /** `insert(...).values(v)` 의 `v`, `update(...).set(v)` 의 `v`. 없으면 `undefined`. */
  values?: Record<string, unknown>;
  /**
   * `execute(sql\`...\`)` 로 보낸 문장 그대로.
   *
   * 🔴 **직접 적은 SQL 은 `values` 로 들여다볼 수 없다.** 그 문장이 무엇을 저장하고 무엇을
   * 조건으로 거는지는 `new PgDialect().sqlToQuery(call.query)` 로 렌더해서 본다 —
   * 그러지 않으면 조건이 통째로 빠져도 시험이 초록이다.
   */
  query?: SQLWrapper;
}

/** 미리 적어 두는 단계 하나 — 이 종류의 호출이 오면 이 행들을 돌려준다. */
export interface FakeStep {
  kind: FakeOpKind;
  rows: unknown[];
  /** 이 단계가 실패하는 경우(Driver 오류 등). 주면 `rows` 대신 이것을 던진다. */
  throws?: unknown;
}

export const selects = (rows: unknown[] = []): FakeStep => ({
  kind: "select",
  rows,
});
export const inserts = (rows: unknown[] = []): FakeStep => ({
  kind: "insert",
  rows,
});
export const updates = (rows: unknown[] = []): FakeStep => ({
  kind: "update",
  rows,
});
export const deletes = (rows: unknown[] = []): FakeStep => ({
  kind: "delete",
  rows,
});
/**
 * 직접 적은 SQL 한 문장(`executor.execute(sql\`...\`)`).
 *
 * 🔴 결과 모양이 다른 것에 주의한다 — Driver 가 돌려주는 `{ rows }` 다. 제품 코드가
 * `.rows` 를 읽으므로 Fake 도 같은 모양으로 돌려준다.
 */
export const executes = (rows: unknown[] = []): FakeStep => ({
  kind: "execute",
  rows,
});

/** 그 단계에서 Database 가 오류를 던지는 경우. unique 위반 처리 등을 볼 때 쓴다. */
export const failsWith = (kind: FakeOpKind, error: unknown): FakeStep => ({
  kind,
  rows: [],
  throws: error,
});

export interface FakeExecutorHandle {
  /** Application Service 에 그대로 넘기는 값. */
  executor: DbExecutor;
  /** 일어난 순서대로의 호출 기록. */
  calls: FakeCall[];
  /** 아직 쓰이지 않은 단계 수. 0 이 아니면 기대한 만큼 Database 를 부르지 않았다는 뜻이다. */
  remaining: () => number;
}

/**
 * Drizzle 의 Query Builder 흉내.
 *
 * `from` · `where` · `limit` · `innerJoin` · `orderBy` · `groupBy` · `for` · `onConflictDoNothing`
 * · `returning` 같은 중간 단계는 **전부 자기 자신을 돌려준다.** 결과는 `await` 하는 순간
 * 정해지고, 그 값은 이 chain 이 만들어질 때 이미 뽑혀 있다.
 */
function buildChain(
  settle: () => Promise<unknown>,
  onValues: (values: Record<string, unknown>) => void,
): unknown {
  let pending: Promise<unknown> | null = null;
  const resolve = (): Promise<unknown> => (pending ??= settle());

  const chain: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        // Symbol 접근(`Symbol.toStringTag` 등)에 함수를 돌려주면 검사기·출력이 오작동한다.
        if (typeof property === "symbol") {
          return undefined;
        }
        if (property === "then") {
          return (...args: Parameters<Promise<unknown>["then"]>) =>
            resolve().then(...args);
        }
        if (property === "catch") {
          return (...args: Parameters<Promise<unknown>["catch"]>) =>
            resolve().catch(...args);
        }
        if (property === "finally") {
          return (...args: Parameters<Promise<unknown>["finally"]>) =>
            resolve().finally(...args);
        }

        return (...args: unknown[]) => {
          if (property === "values" || property === "set") {
            const candidate = args[0];
            if (typeof candidate === "object" && candidate !== null) {
              onValues(candidate as Record<string, unknown>);
            }
          }
          return chain;
        };
      },
    },
  );

  return chain;
}

export function fakeExecutor(script: FakeStep[]): FakeExecutorHandle {
  const steps = [...script];
  const calls: FakeCall[] = [];

  function start(kind: FakeOpKind, query?: SQLWrapper): unknown {
    const step = steps.shift();
    if (step === undefined) {
      throw new Error(
        `Fake 에 적어 둔 단계보다 많이 불렸다: ${kind} (${calls.length + 1}번째)`,
      );
    }
    if (step.kind !== kind) {
      throw new Error(
        `${calls.length + 1}번째 호출이 «${step.kind}» 일 것으로 적혀 있는데 «${kind}» 였다`,
      );
    }

    const call: FakeCall = { kind };
    if (query !== undefined) {
      call.query = query;
    }
    calls.push(call);

    return buildChain(
      () =>
        "throws" in step && step.throws !== undefined
          ? Promise.reject(step.throws)
          : // Driver 가 돌려주는 모양이 다르다 — `execute` 만 `{ rows }` 다.
            Promise.resolve(kind === "execute" ? { rows: step.rows } : step.rows),
      (values) => {
        call.values = values;
      },
    );
  }

  const executor = {
    select: () => start("select"),
    insert: () => start("insert"),
    update: () => start("update"),
    delete: () => start("delete"),
    execute: (query: SQLWrapper) => start("execute", query),
    /**
     * 🔴 **Transaction 을 흉내 내지 않는다.** 되돌림도 격리도 없다 — 안쪽 코드를 그대로
     * 부르고 던져진 것을 그대로 올려보낼 뿐이다. 「실패하면 함께 되돌아간다」는 Fake 로
     * 증명할 수 없고, 그것은 통합시험이 볼 몫이다.
     */
    transaction: <T>(run: (tx: DbExecutor) => Promise<T>): Promise<T> =>
      run(executor as unknown as DbExecutor),
  };

  return {
    executor: executor as unknown as DbExecutor,
    calls,
    remaining: () => steps.length,
  };
}
