import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";

// ============================================================
// 자동 시계(Cron): 매일 아침 한 번 깨어나서
//  - 오늘이 리마인드 기간(예: 1일~2일)인지 확인
//  - 이번 달 담당자가 아직 '완료' 안 했으면 단톡방에 알림
// Vercel Cron 이 매일 이 주소를 호출함
// ============================================================

export async function GET(request: Request) {
  // 나(Vercel Cron)만 호출할 수 있게 비밀 열쇠 확인
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "권한 없음" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // 한국 시간(KST) 기준 오늘 날짜
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  );
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1~12
  const today = now.getDate();

  // 켜져 있는 반복 업무들 가져오기
  const { data: duties, error: dutyErr } = await supabase
    .from("duties")
    .select("*")
    .eq("active", true);

  if (dutyErr) {
    return NextResponse.json({ error: dutyErr.message }, { status: 500 });
  }

  const sent: string[] = [];

  for (const duty of duties ?? []) {
    const start = duty.day_of_month;
    const end = duty.day_of_month + duty.remind_days - 1;

    // 오늘이 리마인드 기간 안이 아니면 건너뜀
    if (today < start || today > end) continue;

    // 이번 달 담당자 지정 확인
    const { data: assignment } = await supabase
      .from("assignments")
      .select("*, members(name)")
      .eq("duty_id", duty.id)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    // 담당자가 아직 안 정해졌으면 "담당자 지정하세요" 알림
    if (!assignment || !assignment.member_id) {
      await sendTelegramMessage(
        `⚠️ <b>${duty.title}</b>\n이번 달(${month}월) 담당자가 아직 지정되지 않았어요. 앱에서 담당자를 정해주세요!`,
      );
      sent.push(`${duty.title}: 담당자 미지정 알림`);
      continue;
    }

    // 이미 완료했으면 알림 안 보냄
    if (assignment.status === "done") continue;

    // 담당자에게 리마인드
    const name =
      (assignment.members as { name?: string } | null)?.name ?? "담당자";
    const dayLeft = end - today; // 남은 날
    const tail =
      dayLeft > 0 ? `\n(리마인드 ${dayLeft}일 더 남음)` : "\n(오늘이 마지막 날!)";

    await sendTelegramMessage(
      `🔔 <b>${duty.title}</b>\n${name}님, 오늘 담당이에요! 완료하면 앱에서 '완료' 눌러주세요 ✅${tail}`,
    );
    sent.push(`${duty.title}: ${name}에게 리마인드`);
  }

  return NextResponse.json({
    ok: true,
    date: `${year}-${month}-${today}`,
    sent,
  });
}
