import { z } from "zod";

import { completeGithubInstallation } from "@/features/repositories/server/github-installation-service";
import { currentUser } from "@/lib/auth/session";

const callbackSchema = z.object({
  code: z.string().min(1).max(500),
  state: z.string().min(32).max(200),
  installation_id: z.string().regex(/^\d+$/),
});

/** GitHub App OAuth callback. user token은 설치 소유권 확인 뒤 저장하지 않는다. */
export async function GET(request: Request): Promise<Response> {
  const user = await currentUser();
  if (user === null) return Response.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const parsed = callbackSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success)
    return Response.redirect(new URL("/?github=invalid", request.url));

  try {
    const destination = await completeGithubInstallation({
      userId: user.id,
      state: parsed.data.state,
      code: parsed.data.code,
      installationId: parsed.data.installation_id,
    });
    return Response.redirect(
      new URL(
        `/w/${encodeURIComponent(destination.workspaceSlug)}/p/${encodeURIComponent(destination.projectSlug)}/repositories?github=connected`,
        request.url,
      ),
    );
  } catch {
    // callback query나 GitHub 응답 원문은 노출·기록하지 않는다.
    return Response.redirect(new URL("/?github=error", request.url));
  }
}
