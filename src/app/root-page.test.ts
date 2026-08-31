import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  ensurePersonalWorkspace: vi.fn(),
  findMembership: vi.fn(),
  listMemberWorkspaces: vi.fn(),
  readLastWorkspaceSlug: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/auth/components/AuthShell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/auth/components/LoginLandingPage", () => ({
  LoginLandingPage: ({ error }: { error?: string | string[] }) => ({ error }),
}));
vi.mock("@/lib/auth/session", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/auth/workspace-context", () => ({
  findMembership: mocks.findMembership,
  listMemberWorkspaces: mocks.listMemberWorkspaces,
}));
vi.mock("@/lib/workspace/last-workspace", () => ({
  readLastWorkspaceSlug: mocks.readLastWorkspaceSlug,
}));
vi.mock("@/lib/workspace/personal-workspace", () => ({
  ensurePersonalWorkspace: mocks.ensurePersonalWorkspace,
}));

import LandingPage from "@/app/page";

describe("root Landing Page route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("비로그인 요청은 redirect하지 않고 Landing을 렌더한다", async () => {
    mocks.currentUser.mockResolvedValue(null);

    const result = await LandingPage({
      searchParams: Promise.resolve({ error: "OAuthSignin" }),
    } as never);

    expect(result).not.toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.readLastWorkspaceSlug).not.toHaveBeenCalled();
  });

  it("로그인 사용자는 기존 Workspace 진입 흐름을 유지한다", async () => {
    mocks.currentUser.mockResolvedValue({ id: "user-1", name: null, image: null });
    mocks.readLastWorkspaceSlug.mockResolvedValue("acme");
    mocks.findMembership.mockResolvedValue({ slug: "acme" });

    await expect(
      LandingPage({ searchParams: Promise.resolve({}) } as never),
    ).rejects.toThrow("redirect:/w/acme/dashboard");

    expect(mocks.findMembership).toHaveBeenCalledWith("user-1", "acme");
    expect(mocks.redirect).toHaveBeenCalledWith("/w/acme/dashboard");
  });
});
