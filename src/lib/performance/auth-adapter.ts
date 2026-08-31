import "server-only";

import type { Adapter } from "next-auth/adapters";

import { measurePerformance } from "@/lib/performance/timing";

const AUTH_ADAPTER_TIMING_LABELS = {
  createUser: "auth.db.user.create",
  getUser: "auth.db.user.get",
  getUserByEmail: "auth.db.user.get_by_email",
  getUserByAccount: "auth.db.account.get_user",
  updateUser: "auth.db.user.update",
  deleteUser: "auth.db.user.delete",
  linkAccount: "auth.db.account.link",
  unlinkAccount: "auth.db.account.unlink",
  createSession: "auth.db.session.create",
  getSessionAndUser: "auth.db.session.get",
  updateSession: "auth.db.session.update",
  deleteSession: "auth.db.session.delete",
} satisfies Partial<Record<keyof Adapter, string>>;

/** Auth.js Adapter 호출을 바꾸지 않고 메서드별 elapsed time만 기록한다. */
export function withAuthPerformance(adapter: Adapter): Adapter {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      const label =
        typeof property === "string"
          ? AUTH_ADAPTER_TIMING_LABELS[
              property as keyof typeof AUTH_ADAPTER_TIMING_LABELS
            ]
          : undefined;

      if (label === undefined || typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) =>
        measurePerformance(label, () => Reflect.apply(value, target, args));
    },
  });
}
