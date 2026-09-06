import { NextResponse, after } from "next/server";
import { AREAS, tg } from "@/lib/cleaning";
import { AI_MODEL } from "@/lib/ai";
import {
  collectPhoto,
  processAfterCollect,
  recoverStale,
  parseCallback,
  handleDecision,
  handleTypedPlace,
  todaySummaryText,
  monthCostText,
  type TgUser,
  type TgPhotoSize,
} from "@/lib/reports";

// ============================================================
// 사진 업무보고 봇 (텔레그램 웹훅)
//
// 직원: 봇에게 1:1 로 사진(여러 장 가능)을 보낸다 → 끝.
// 봇: AI 가 사진을 보고 보고문을 써서 [✅ 이대로 보고] 버튼을 띄움
//     확신이 낮으면 질문 딱 1개(버튼) → 답하면 바로 게시
//     AI 가 없거나 실패하면 구역 버튼(예전 방식)으로 내려감
// 명령: /오늘 (현황) /비용 (이번 달 AI 비용) /start (안내)
// ============================================================

export const maxDuration = 60; // 사진 다운로드 + AI 분석 시간 여유

type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  photo?: TgPhotoSize[];
  media_group_id?: string;
};
type TgCallback = { id: string; from: TgUser; data?: string; message?: TgMessage };
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback };

// 허용된 사람만 쓰게 (CLEANING_USER_IDS="123,456" 형태, 비워두면 누구나)
function isAllowed(userId?: number) {
  const raw = process.env.CLEANING_USER_IDS?.trim();
  if (!raw) return true;
  return !!userId && raw.split(",").map((s) => s.trim()).includes(String(userId));
}

async function onText(msg: TgMessage) {
  const text = (msg.text ?? "").trim();
  const send = (t: string) => tg("sendMessage", { chat_id: msg.chat.id, parse_mode: "HTML", text: t });

  if (text.startsWith("/start") || text.startsWith("/help") || text === "?") {
    const aiOn = !!process.env.ANTHROPIC_API_KEY;
    await send(
      `📷 <b>사진 업무보고 봇</b>\n\n` +
        `1. 일한 곳 사진을 찍어서 여기로 보내세요 (여러 장 한 번에 OK)\n` +
        `2. 봇이 보고문을 써서 보여주면 <b>[✅ 이대로 보고]</b> 한 번\n` +
        `3. 끝! 공용방에 사진과 문장이 자동으로 올라갑니다\n\n` +
        `구역: ${AREAS.join(" / ")}\n` +
        `/오늘 → 오늘 현황 · /비용 → 이번 달 AI 비용\n\n` +
        `<i>AI: ${aiOn ? AI_MODEL : "꺼짐(구역 버튼 방식)"} · 내 텔레그램 번호: ${msg.from?.id}</i>`,
    );
    return;
  }
  if (text.startsWith("/오늘") || text.startsWith("/today") || text.startsWith("/status")) {
    await send(await todaySummaryText());
    return;
  }
  if (text.startsWith("/비용") || text.startsWith("/cost")) {
    await send(await monthCostText());
    return;
  }
  await tg("sendMessage", {
    chat_id: msg.chat.id,
    text: "사진을 보내주시면 제가 보고문을 써드릴게요 📷  (/오늘 현황, /비용 비용)",
  });
}

async function onCallback(cb: TgCallback) {
  const answer = (text: string, alert = false) =>
    tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });

  if (!isAllowed(cb.from.id)) {
    await answer("권한이 없어요.", true);
    return;
  }
  const parsed = parseCallback(cb.data ?? "");
  if (!parsed) {
    await answer("오래된 버튼이에요. 사진을 다시 보내주세요.", true);
    return;
  }
  // 텔레그램은 버튼 응답을 빨리 원하므로 먼저 "처리 중" 응답
  await answer("처리 중…");
  const result = await handleDecision(parsed.reportId, parsed.decision);
  if (result) {
    // 결과는 버튼 메시지 수정으로 이미 보였으므로, 오류일 때만 한 줄 더
    if (!result.includes("완료") && result !== "취소됨") {
      await tg("sendMessage", { chat_id: cb.message?.chat.id ?? cb.from.id, text: result });
    }
  }
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "권한 없음" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.callback_query) {
      await onCallback(update.callback_query);
    } else if (update.message) {
      const msg = update.message;
      if (msg.chat.type !== "private") return NextResponse.json({ ok: true }); // 단톡방에선 조용히

      if (!isAllowed(msg.from?.id)) {
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: `이 봇을 쓸 권한이 없어요. (내 번호: ${msg.from?.id})`,
        });
      } else if (msg.photo?.length) {
        const { reportId } = await collectPhoto({
          chatId: msg.chat.id,
          messageId: msg.message_id,
          mediaGroupId: msg.media_group_id,
          from: msg.from,
          sizes: msg.photo,
        });
        // 텔레그램에 먼저 200 을 돌려주고, 뒤에서 모으기→분석→버튼 진행
        after(async () => {
          try {
            await processAfterCollect(reportId, msg.message_id, !!msg.media_group_id);
          } catch (e) {
            console.error("보고 처리 오류:", e);
          }
        });
      } else if (msg.text) {
        after(() => recoverStale(msg.chat.id).catch((e) => console.error("복구 오류:", e)));
        // 장소를 글자로 답하는 중이면 그걸로 게시
        const handled = await handleTypedPlace(msg.chat.id, msg.text);
        if (!handled) await onText(msg);
      } else {
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: "사진으로 보내주세요 📷 (파일로 보내면 못 읽어요)",
        });
      }
    }
  } catch (e) {
    // 200 을 못 받으면 텔레그램이 같은 메시지를 계속 다시 보내므로, 오류는 기록만 하고 200
    console.error("텔레그램 웹훅 처리 오류:", e);
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    bot: "photo-report",
    areas: AREAS,
    ai: process.env.ANTHROPIC_API_KEY ? AI_MODEL : "off",
  });
}
