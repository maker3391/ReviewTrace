import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export interface PerformanceTimingEntry {
  name: string;
  durationMs: number;
}

interface RuntimePerformanceMetadata {
  functionRegion: string;
  dbEndpoint:
    | "direct"
    | "shared-pooler"
    | "dedicated-pooler"
    | "other"
    | "unknown";
  dbPoolMode: "transaction" | "session" | "direct" | "unknown";
  dbRegion: string;
}

const traceStorage = new AsyncLocalStorage<PerformanceTrace>();

function roundedDuration(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function runtimeMetadata(): RuntimePerformanceMetadata {
  const raw = process.env.DATABASE_URL;
  let dbEndpoint: RuntimePerformanceMetadata["dbEndpoint"] = "unknown";
  let dbPoolMode: RuntimePerformanceMetadata["dbPoolMode"] = "unknown";
  let dbRegion = "unknown";

  if (raw !== undefined) {
    try {
      const url = new URL(raw);
      const sharedPooler = /^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/i.exec(
        url.hostname,
      );

      if (sharedPooler !== null) {
        dbEndpoint = "shared-pooler";
        dbRegion = sharedPooler[1] ?? "unknown";
        dbPoolMode = url.port === "6543" ? "transaction" : "session";
      } else if (url.hostname.startsWith("db.") && url.port === "6543") {
        dbEndpoint = "dedicated-pooler";
        dbPoolMode = "transaction";
      } else if (url.hostname.startsWith("db.")) {
        dbEndpoint = "direct";
        dbPoolMode = "direct";
      } else {
        dbEndpoint = "other";
      }
    } catch {
      // URL 자체나 parse 오류를 로그에 넣지 않는다.
    }
  }

  return {
    functionRegion: process.env.VERCEL_REGION ?? "local",
    dbEndpoint,
    dbPoolMode,
    dbRegion,
  };
}

/**
 * 민감정보 없이 서버 단계별 elapsed time만 모으는 임시 운영 계측기.
 * 호출 인자나 반환값은 받지도, 보관하지도 않는다.
 */
export class PerformanceTrace {
  readonly #startedAt = performance.now();
  readonly #entries: PerformanceTimingEntry[] = [];

  constructor(
    readonly scope: string,
    readonly id: string = crypto.randomUUID(),
  ) {}

  async time<T>(name: string, task: () => Promise<T> | T): Promise<T> {
    const startedAt = performance.now();
    try {
      return await task();
    } finally {
      this.#entries.push({ name, durationMs: roundedDuration(startedAt) });
    }
  }

  entries(): readonly PerformanceTimingEntry[] {
    return this.#entries;
  }

  serverTiming(): string {
    return this.#entries
      .map(({ name, durationMs }) => `${name};dur=${durationMs.toFixed(1)}`)
      .join(", ");
  }

  log(): void {
    console.info(
      JSON.stringify({
        type: "performance",
        scope: this.scope,
        traceId: this.id,
        totalMs: roundedDuration(this.#startedAt),
        ...runtimeMetadata(),
        timings: this.#entries,
      }),
    );
  }
}

export function runWithPerformanceTrace<T>(
  trace: PerformanceTrace,
  task: () => Promise<T>,
): Promise<T> {
  return traceStorage.run(trace, task);
}

export function measurePerformance<T>(
  name: string,
  task: () => Promise<T> | T,
): Promise<T> {
  const trace = traceStorage.getStore();
  return trace === undefined ? Promise.resolve(task()) : trace.time(name, task);
}

export function runtimePerformanceHeaders(): Record<string, string> {
  const metadata = runtimeMetadata();
  return {
    "x-reviewtrace-function-region": metadata.functionRegion,
    "x-reviewtrace-db-endpoint": metadata.dbEndpoint,
    "x-reviewtrace-db-pool-mode": metadata.dbPoolMode,
    "x-reviewtrace-db-region": metadata.dbRegion,
  };
}
