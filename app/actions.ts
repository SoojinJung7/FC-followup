"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram";

// 로그인 확인 (안 되어 있으면 로그인 페이지로)
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return supabase;
}

// 부서원 추가
export async function addMember(formData: FormData) {
  const supabase = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("members").insert({
    name,
    telegram_username:
      String(formData.get("telegram_username") ?? "").trim() || null,
  });
  revalidatePath("/");
}

// 부서원 삭제(비활성)
export async function removeMember(formData: FormData) {
  const supabase = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase.from("members").update({ active: false }).eq("id", id);
  revalidatePath("/");
}

// 이번 달 담당자 지정 (없으면 새로 만들고, 있으면 바꿈)
export async function assignMember(formData: FormData) {
  const supabase = await requireUser();
  const dutyId = String(formData.get("duty_id") ?? "");
  const memberId = String(formData.get("member_id") ?? "") || null;
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!dutyId || !year || !month) return;

  await supabase.from("assignments").upsert(
    {
      duty_id: dutyId,
      year,
      month,
      member_id: memberId,
      status: "pending",
    },
    { onConflict: "duty_id,year,month" },
  );
  revalidatePath("/");
}

// 완료 / 완료취소 토글
export async function toggleDone(formData: FormData) {
  const supabase = await requireUser();
  const id = String(formData.get("id") ?? "");
  const nextStatus = String(formData.get("next_status") ?? "done");
  if (!id) return;
  await supabase
    .from("assignments")
    .update({
      status: nextStatus,
      completed_at: nextStatus === "done" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  revalidatePath("/");
}

// 지금 바로 테스트 알림 보내기 (단톡방 연결 확인용)
export async function sendTestMessage() {
  await requireUser();
  await sendTelegramMessage(
    "✅ FC 팔로업 봇 연결 테스트입니다. 이 메시지가 보이면 성공!",
  );
  revalidatePath("/");
}

// 로그아웃
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
