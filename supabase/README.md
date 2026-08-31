# Supabase Root CA

`prod-ca-2021.crt` — Supabase 가 배포하는 **공개 루트 인증서**다
(**Project Settings → Database → SSL Configuration** 에서 내려받는다).

```
subject : C=US, O=Supabase Inc, CN=Supabase Root 2021 CA
issuer  : (자기 자신 — 루트다)
유효기간 : 2021-04-28 ~ 2031-04-26
```

## 🔴 왜 저장소에 두는가

Supabase 의 서버 인증서는 이 CA 로 서명돼 있고, **Node 의 기본 신뢰 목록에는 없다.**
그래서 `?sslmode=require`(= Node 에서는 완전 검증) 로 붙으면 이렇게 끊긴다:

```
code   : SELF_SIGNED_CERT_IN_CHAIN
message: self-signed certificate in certificate chain
```

이 파일을 CA 로 지정하면 **검증을 끄지 않고** 통과한다:

```
?sslmode=verify-full&sslrootcert=supabase/prod-ca-2021.crt
```

경로는 프로세스의 **cwd 기준 상대 경로**로 읽힌다 — GitHub Actions 의 cwd 는 저장소 루트다.

🔴 **이것은 비밀이 아니다.** 서버를 «검증하는» 쪽 인증서이고 개인키가 아니다 —
누구나 내려받는 공개 자산이라 커밋해도 된다. 개인키(`BEGIN PRIVATE KEY`)는 여기 없다.

🔴 **이 파일로 로컬 개발이 바뀌지 않는다.** 연결 문자열에 `sslrootcert` 를 적은 곳만 쓴다.
