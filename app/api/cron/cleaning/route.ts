import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tg, cleaningChatId, kstParts, kstTodayRange, buildSummary, type CleaningLog } from "@/lib/cleaning";

// ============================================================
// 매일 저녁(한국 21:00) 한 번: 오늘 청소 현황을 보고방에 올림
//  - 3곳 전부 완료 → "🎉 전부 완료"
//  - 빠진 곳 있음 → "남은 곳: ..." 으로 알려줌
// ============================================================

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "권한 없음" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { dateStr, startISO, endISO } = kstTodayRange();

  const { data, error } = await supabase
    .from("cleaning_logs")
    .select("area, reported_at, reporter_name")
    .gte("reported_at", startISO)
    .lt("reported_at", endISO)
    .order("reported_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { label } = kstParts(new Date(`${dateStr}T12:00:00+09:00`));
  const { text, done, left } = buildSummary((data ?? []) as CleaningLog[], label);

  await tg("sendMessage", {
    chat_id: cleaningChatId(),
    parse_mode: "HTML",
    text,
  });

  return NextResponse.json({ ok: true, date: dateStr, done, left });
}
