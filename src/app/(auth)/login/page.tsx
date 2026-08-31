import { permanentRedirect } from "next/navigation";

/** 중복 Landing URL을 남기지 않고 공식 대표 URL인 루트로 합친다. */
export default async function LoginRedirectPage(props: PageProps<"/login">) {
 const { error } = await props.searchParams;

 if (typeof error === "string" && error !== "") {
 permanentRedirect(`/?error=${encodeURIComponent(error)}`);
 }

 permanentRedirect("/");
}
