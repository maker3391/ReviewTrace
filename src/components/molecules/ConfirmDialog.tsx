"use client";

import { useRef, useState, type ReactNode } from "react";

import { Spinner } from "@/components/atoms/Spinner";
import { Button } from "@/components/ui/button";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action/action-result";

/**
 * 되돌릴 수 없는 일을 하기 전에 한 번 묻는다.
 *
 * 🔴 **`window.confirm` 을 쓰지 않는다** — 브라우저 모달은 자동화 도구에서 세션을 통째로
 * 멈추게 하고, 화면의 문자 계층·언어를 따르지도 않는다.
 *
 * 🔴 **새 Dialog 를 만들지 않는다.** shadcn `alert-dialog` 를 새로 들이는 대신 이미 있는
 * `components/ui/dialog` 위에 올렸다 — backdrop · focus trap · ESC ·
 * `aria-describedby` 는 Radix Dialog 가 이미 갖고 있고, 여기서 더할 것은 **`alertdialog`
 * 역할과 destructive 한 짝의 버튼**뿐이다.
 *
 * 🔴 **문구를 여기 담지 않는다.** `title` · `description` · `actionLabel` · `cancelLabel`
 * 은 caller 가 넘긴다 — 이 Component 는 어떤 도메인도 알지 못해야 하고, 문구는 화면 언어를
 * 아는 쪽(서버가 넘긴 사전)에서 온다.
 *
 * 🔴 **닫는 X 를 두지 않는다.** 「취소」와 X 가 같은 뜻으로 둘 다 서 있으면 어느 쪽이
 * 안전한 길인지 흐려진다. 나가는 길은 「취소」 하나다.
 *
 * ## 실패는 dialog 를 닫지 않는다
 *
 * Server Action 의 실패는 예외가 아니라 `ActionResult` 로 온다.
 * 실패하면 **dialog 를 그대로 두고** 사유를 안에 그린 뒤 pending 만 푼다 — 닫아 버리면
 * 사용자가 방금 채운 확인 입력과 사유를 함께 잃고, 무엇이 잘못됐는지 모른 채 처음부터
 * 다시 해야 한다.
 *
 * 성공 뒤의 이동·갱신은 `onConfirm` 안에서 한다 — 이 Component 는 결과가 `ok` 이면
 * 닫기만 한다.
 *
 * ```tsx
 * <ConfirmDialog
 * open={open}
 * onOpenChange={setOpen}
 * title="문서를 삭제할까요?"
 * description="‘Transaction 경계 규칙’ 을(를) 지웁니다."
 * consequence="삭제한 문서는 복구할 수 없습니다."
 * actionLabel="삭제"
 * cancelLabel="취소"
 * onConfirm={async () => {
 * const result = await deleteAction(...);
 * if (result.ok) router.push(listPath);
 * return result;
 * }}
 * />
 * ```
 */
export function ConfirmDialog({
 open,
 onOpenChange,
 title,
 description,
 consequence,
 actionLabel,
 cancelLabel,
 onConfirm,
 confirmDisabled = false,
 children,
}: {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 title: string;
 /** 무엇을 잃는지 한 줄. 🔴 실제로 일어나는 일만 적는다 — 없는 영향을 짐작해 적지 않는다. */
 description: ReactNode;
 /**
 * 「그래서 어떻게 되는가」. 되돌릴 수 없다는 것처럼 **대상과 성격이 다른** 한 줄을
 * 따로 받는다 — 한 문단으로 이어 붙이면 경고가 대상 이름 뒤에 묻힌다.
 *
 * 🔴 **없으면 두지 않는다.** 한 줄로 충분한 자리는 지금처럼 한 줄이다.
 */
 consequence?: ReactNode;
 actionLabel: string;
 cancelLabel: string;
 onConfirm: () => Promise<ActionResult<unknown>>;
 /** 확인 입력이 아직 맞지 않는 것처럼, caller 가 실행을 막아야 할 때. */
 confirmDisabled?: boolean;
 /** 한 번 더 확인받아야 할 입력(예: 이름 그대로 입력). 없으면 두지 않는다. */
 children?: ReactNode;
}) {
 const [pending, setPending] = useState(false);
 const [failure, setFailure] = useState<string | null>(null);

 /*
 🔴 **`pending` state 만으로는 두 번 눌리는 것을 막지 못한다.** 첫 클릭의
 `setPending(true)` 가 화면에 반영되기 전에 두 번째 click 이 이미 큐에 들어와 있을 수
 있다 — 그러면 같은 Server Action 이 두 번 나간다. 실행 여부는 렌더와 무관한 ref 가
 갖는다.
 */
 const running = useRef(false);

 async function confirm() {
 if (running.current) {
 return;
 }
 running.current = true;
 setPending(true);
 setFailure(null);

 try {
 const result = await onConfirm();

 if (!result.ok) {
 // 🔴 사용자용 message 만 그린다. 원본 오류를 화면에 내보내지 않는다.
 setFailure(result.error.message);
 return;
 }

 onOpenChange(false);
 } finally {
 running.current = false;
 setPending(false);
 }
 }

 return (
 <Dialog
 open={open}
 onOpenChange={(next) => {
 /*
 🔴 **실행 중에는 ESC·바깥 클릭으로 닫히지 않는다.** 요청은 이미 서버로 갔는데
 화면만 사라지면, 사용자는 그것이 됐는지 안 됐는지 알 방법이 없다.
 */
 if (pending) {
 return;
 }
 if (!next) {
 setFailure(null);
 }
 onOpenChange(next);
 }}
 >
 <DialogContent role="alertdialog" showCloseButton={false}>
 <DialogHeader>
 <DialogTitle className="text-sm">{title}</DialogTitle>
 {/*
 🔴 **두 줄을 «하나의» Description 안에 둔다.** Radix 가 `aria-describedby`
 로 가리키는 것은 이 요소 하나라, 밖으로 문단을 하나 더 빼면 읽어 주는 도구가
 그 줄을 읽지 않는다. 새 표면·선·색을 더하지 않고 여백만 한 단계 준다
.
 */}
 <DialogDescription>
 {description}
 {consequence !== undefined && (
 <span className="mt-1.5 block">{consequence}</span>
)}
 </DialogDescription>
 </DialogHeader>

 {children}

 {failure !== null && (
 <p role="alert" className="text-xs text-destructive">
 {failure}
 </p>
)}

 <DialogFooter>
 {/*
 🔴 **안전한 쪽이 먼저 선다.** DOM 순서가 곧 focus 순서라, 열리자마자 손이
 닿는 자리가 「취소」다 — Enter 한 번에 지워지지 않는다.
 */}
 <Button
 type="button"
 size="sm"
 variant="ghost"
 onClick={() => onOpenChange(false)}
 disabled={pending}
 >
 {cancelLabel}
 </Button>
 <Button
 type="button"
 size="sm"
 variant="destructive"
 onClick={confirm}
 disabled={pending || confirmDisabled}
 >
 {/* 🔴 label 을 갈아 끼우지 않는다 — 무엇을 실행 중인지가 계속 보여야 한다. */}
 {pending && <Spinner />}
 {actionLabel}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
);
}
