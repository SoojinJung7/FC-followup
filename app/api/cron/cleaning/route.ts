import { NextResponse } from "next/server";
import { tg, cleaningChatId, kstParts } from "@/lib/cleaning";
import { todaySummaryText } from "@/lib/reports";

// ============================================================
// 매일 저녁(한국 21:00) 한 번: 오늘 업무 보고 현황을 공용방에 올림
// ============================================================

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "권한 없음" }, { status: 401 });
  }
  const text = await todaySummaryText();
  await tg("sendMessage", { chat_id: cleaningChatId(), parse_mode: "HTML", text });
  return NextResponse.json({ ok: true, date: kstParts().dateStr });
}
