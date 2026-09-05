import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AREAS,
  tg,
  cleaningChatId,
  kstParts,
  kstTodayRange,
  buildSummary,
  type CleaningLog,
} from "@/lib/cleaning";

// ============================================================
// 청소 보고 봇 (텔레그램 웹훅)
//
// 쓰는 법: 봇에게 1:1 로 사진 한 장 보내기
//   → 봇이 구역 버튼(1층 로비 / 2층 샤워실 / 3층 락커) 을 띄움
//   → 버튼 하나 누르면 보고방에 "🧹 청소 완료 | 구역 / 시각 / 이름 + 사진" 이 올라감
//   → 기록표(cleaning_logs) 에도 저장 → 저녁 요약·/오늘 명령에서 사용
//
// 글자 명령: /오늘 (오늘 현황), /start (안내)
// ============================================================

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
type TgPhoto = { file_id: string; width: number; height: number };
type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: TgPhoto[];
  document?: { file_id: string; mime_type?: string };
  media_group_id?: string;
  reply_to_message?: TgMessage;
};
type TgCallback = {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
};
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback };

const displayName = (u?: TgUser) =>
  [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "익명";

// 허용된 사람만 쓰게 (CLEANING_USER_IDS="123,456" 형태, 비워두면 누구나)
function isAllowed(userId?: number) {
  const raw = process.env.CLEANING_USER_IDS?.trim();
  if (!raw || !userId) return !raw;
  return raw.split(",").map((s) => s.trim()).includes(String(userId));
}

function areaKeyboard() {
  return {
    inline_keyboard: [
      ...AREAS.map((a, i) => [{ text: `🧹 ${a}`, callback_data: `clean:${i}` }]),
      [{ text: "✖ 취소", callback_data: "clean:cancel" }],
    ],
  };
}

async function todaySummaryText() {
  const supabase = createAdminClient();
  const { dateStr, startISO, endISO } = kstTodayRange();
  const { data } = await supabase
    .from("cleaning_logs")
    .select("area, reported_at, reporter_name")
    .gte("reported_at", startISO)
    .lt("reported_at", endISO)
    .order("reported_at", { ascending: true });
  const { label } = kstParts(new Date(`${dateStr}T12:00:00+09:00`));
  return buildSummary((data ?? []) as CleaningLog[], label).text;
}

// ---------- 사진이 왔을 때: 구역 버튼 띄우기 ----------
async function onPhoto(msg: TgMessage) {
  await tg("sendMessage", {
    chat_id: msg.chat.id,
    reply_to_message_id: msg.message_id,
    text: "어느 구역이에요? 👇",
    reply_markup: areaKeyboard(),
  });
}

// ---------- 글자 명령 ----------
async function onText(msg: TgMessage) {
  const text = (msg.text ?? "").trim();

  if (text.startsWith("/start") || text.startsWith("/help") || text === "?") {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      parse_mode: "HTML",
      text:
        `🧹 <b>청소 보고 봇</b>\n\n` +
        `1. 청소한 곳 사진을 찍어서 여기로 보내세요\n` +
        `2. 뜨는 버튼에서 구역을 누르세요\n` +
        `3. 끝! 보고방에 자동으로 올라갑니다\n\n` +
        `구역: ${AREAS.join(" / ")}\n` +
        `/오늘 → 오늘 어디까지 했는지 보기\n\n` +
        `<i>내 텔레그램 번호: ${msg.from?.id}</i>`,
    });
    return;
  }

  if (text.startsWith("/오늘") || text.startsWith("/today") || text.startsWith("/status")) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      parse_mode: "HTML",
      text: await todaySummaryText(),
    });
    return;
  }

  // 그 외 글자는 살짝 안내만
  if (msg.chat.type === "private") {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "사진을 보내주시면 구역 버튼이 떠요 📷  (/오늘 로 현황 확인)",
    });
  }
}

// ---------- 구역 버튼을 눌렀을 때: 보고방에 올리고 기록 ----------
async function onCallback(cb: TgCallback) {
  const data = cb.data ?? "";
  const btnMsg = cb.message;
  if (!btnMsg) return;

  const answer = (text: string, alert = false) =>
    tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });

  if (!isAllowed(cb.from.id)) {
    await answer("권한이 없어요.", true);
    return;
  }

  if (data === "clean:cancel") {
    await tg("editMessageText", {
      chat_id: btnMsg.chat.id,
      message_id: btnMsg.message_id,
      text: "취소했어요. 다시 보내려면 사진을 다시 보내주세요.",
    });
    await answer("취소됨");
    return;
  }

  const idx = Number(data.replace("clean:", ""));
  const area = AREAS[idx];
  if (!area) {
    await answer("알 수 없는 구역이에요.", true);
    return;
  }

  // 버튼 메시지가 '답장'으로 달려 있던 원래 사진에서 file_id 꺼내기 (가장 큰 사이즈)
  const original = btnMsg.reply_to_message;
  const photo = original?.photo?.[original.photo.length - 1];
  const fileId =
    photo?.file_id ??
    (original?.document?.mime_type?.startsWith("image/") ? original.document.file_id : undefined);

  if (!fileId) {
    await tg("editMessageText", {
      chat_id: btnMsg.chat.id,
      message_id: btnMsg.message_id,
      text: "원래 사진을 찾지 못했어요. 사진을 다시 보내주세요.",
    });
    await answer("사진 없음", true);
    return;
  }

  const now = new Date();
  const { label, timeStr } = kstParts(now);
  const name = displayName(cb.from);
  const caption =
    `🧹 <b>청소 완료</b> | ${area}\n` +
    `${label} ${timeStr} · ${name}`;

  // 1) 보고방에 사진 + 문구 올리기
  const sent = await tg<{ message_id: number }>("sendPhoto", {
    chat_id: cleaningChatId(),
    photo: fileId,
    caption,
    parse_mode: "HTML",
  });

  // 2) 기록표에 저장
  const supabase = createAdminClient();
  const { error } = await supabase.from("cleaning_logs").insert({
    area,
    reported_at: now.toISOString(),
    reporter_id: cb.from.id,
    reporter_name: name,
    photo_file_id: fileId,
    group_message_id: sent.message_id,
  });
  if (error) console.error("cleaning_logs insert 실패:", error.message);

  // 3) 버튼 메시지를 "완료" 로 바꾸기 (버튼 사라짐)
  await tg("editMessageText", {
    chat_id: btnMsg.chat.id,
    message_id: btnMsg.message_id,
    parse_mode: "HTML",
    text: `✅ <b>${area}</b> 보고 완료 (${timeStr})`,
  });
  await answer(`${area} 보고 완료!`);

  // 4) 오늘 전부 끝났으면 축하 한 줄
  const summary = await todaySummaryText();
  if (summary.includes("전부 완료")) {
    await tg("sendMessage", {
      chat_id: btnMsg.chat.id,
      parse_mode: "HTML",
      text: summary,
    });
  }
}

// ---------- 웹훅 입구 ----------
export async function POST(request: Request) {
  // 텔레그램이 보낸 요청인지 비밀 열쇠로 확인
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
      // 1:1 대화에서만 반응 (단톡방에 봇이 있어도 조용히 있음)
      if (msg.chat.type !== "private") return NextResponse.json({ ok: true });

      if (!isAllowed(msg.from?.id)) {
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: `이 봇을 쓸 권한이 없어요. (내 번호: ${msg.from?.id})`,
        });
      } else if (msg.photo?.length || msg.document?.mime_type?.startsWith("image/")) {
        await onPhoto(msg);
      } else if (msg.text) {
        await onText(msg);
      }
    }
  } catch (e) {
    // 텔레그램은 200 을 못 받으면 같은 메시지를 계속 다시 보내므로, 오류는 기록만 하고 200 응답
    console.error("텔레그램 웹훅 처리 오류:", e);
  }

  return NextResponse.json({ ok: true });
}

// 브라우저로 열어봤을 때 살아있는지 확인용
export async function GET() {
  return NextResponse.json({ ok: true, bot: "cleaning-report", areas: AREAS });
}
