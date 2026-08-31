import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import {
  PerformanceTrace,
  runtimePerformanceHeaders,
} from "@/lib/performance/timing";

const PROBE_TOKEN_HASH = Buffer.from(
  "a2270ce1d0b2844eb9e915c5f70ef8df02c0c8b09c9883fd7e5baa9a14f62874",
  "hex",
);

function isAuthorized(request: Request): boolean {
  const token = request.headers.get("x-reviewtrace-performance-probe");
  if (token === null) {
    return false;
  }

  const actual = createHash("sha256").update(token).digest();
  return timingSafeEqual(actual, PROBE_TOKEN_HASH);
}

/**
 * 임시 운영 DB 왕복 계측.
 *
 * 올바른 일회성 Probe Token 없이는 404로 끝난다. 성공해도 실제 표는 읽지 않고
 * `select 1`의 연결·왕복 시간만 돌려준다. 원인 확인 뒤 route 전체를 제거한다.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response(null, { status: 404 });
  }

  const trace = new PerformanceTrace("db.runtime.probe");
  const database = db();

  await trace.time("db.first_connection", () => database.execute(sql`select 1`));
  await trace.time("db.warm_round_trip", () => database.execute(sql`select 1`));
  await trace.time("db.parallel_7_total", () =>
    Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        trace.time(`db.parallel_${index + 1}`, () =>
          database.execute(sql`select 1`),
        ),
      ),
    ),
  );

  trace.log();
  return Response.json(
    { timings: trace.entries() },
    { headers: runtimePerformanceHeaders() },
  );
}
