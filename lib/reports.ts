// ============================================================
// 사진 업무보고 파이프라인
//   사진 도착 → (앨범이면 2.5초 모음) → AI 분석 → 직원 DM 에 "이대로 보고" 버튼
//   → 직원이 누르면 공용방에 사진 묶음 + 보고문 게시
// AI 가 없거나 실패하면 → 구역 버튼(예전 방식)으로 내려가서 보고는 절대 안 막힘
// ============================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { AREAS, tg, cleaningChatId, kstParts, kstTodayRange, buildSummary, type PostedRow } from "@/lib/cleaning";
import { analyzePhotos, estimateUsd, type Analysis, type AiImage, type AiUsage } from "@/lib/ai";

export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
export type TgPhotoSize = { file_id: string; width: number; height: number };

export const displayName = (u?: TgUser) =>
  [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "익명";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 텔레그램은 한 사진을 여러 크기로 줌. AI 용으로 긴 변 ≤ 1024 중 가장 큰 것을 고름 (비용 절감)
function pickSmall(sizes: TgPhotoSize[]): TgPhotoSize {
  const ok = sizes.filter((s) => Math.max(s.width, s.height) <= 1024);
  return ok.length ? ok[ok.length - 1] : sizes[0];
}

// ---------- 1) 사진 접수: 보고(묶음) 찾거나 만들고, 사진 한 장 붙임 ----------
export async function collectPhoto(opts: {
  chatId: number;
  messageId: number;
  mediaGroupId?: string;
  from?: TgUser;
  sizes: TgPhotoSize[];
}) {
  const supabase = createAdminClient();
  const groupKey = opts.mediaGroupId ?? `single:${opts.messageId}`;

  // 같은 앨범의 사진들이 거의 동시에 오므로 upsert 로 묶음 1개만 만들어짐
  await supabase
    .from("reports")
    .upsert(
      {
        chat_id: opts.chatId,
        media_group_id: groupKey,
        reporter_id: opts.from?.id ?? null,
        reporter_name: displayName(opts.from),
      },
      { onConflict: "chat_id,media_group_id", ignoreDuplicates: true },
    );
  const { data: report, error } = await supabase
    .from("reports")
    .select("id, status")
    .eq("chat_id", opts.chatId)
    .eq("media_group_id", groupKey)
    .single();
  if (error || !report) throw new Error(`보고 묶음 조회 실패: ${error?.message}`);

  const largest = opts.sizes[opts.sizes.length - 1];
  const small = pickSmall(opts.sizes);
  await supabase.from("report_photos").upsert(
    {
      report_id: report.id,
      message_id: opts.messageId,
      file_id: largest.file_id,
      small_file_id: small.file_id,
      width: largest.width,
      height: largest.height,
    },
    { onConflict: "report_id,message_id", ignoreDuplicates: true },
  );

  // 묶음당 딱 한 번, 바로 "받았어요" 답장 (직원은 여기서 폰을 내려놔도 됨)
  const { data: winner } = await supabase
    .from("reports")
    .update({ prompt_message_id: -1 })
    .eq("id", report.id)
    .is("prompt_message_id", null)
    .select("id")
    .maybeSingle();
  if (winner) {
    try {
      const sent = await tg<{ message_id: number }>("sendMessage", {
        chat_id: opts.chatId,
        text: "📷 받았어요! 보고문 쓰는 중이에요…",
      });
      await supabase.from("reports").update({ prompt_message_id: sent.message_id }).eq("id", report.id);
    } catch (e) {
      console.error("접수 답장 실패:", e);
    }
  }

  return { reportId: report.id as string, status: report.status as string };
}

// ---------- 2) 묶음이 다 모였는지 확인하고, 내가 마지막 사진이면 처리 시작 ----------
export async function processAfterCollect(reportId: string, myMessageId: number, isAlbum: boolean) {
  if (isAlbum) await sleep(1500); // 앨범의 나머지 사진이 도착할 시간 (한 장이면 바로)
  const supabase = createAdminClient();

  const { data: photos } = await supabase
    .from("report_photos")
    .select("message_id")
    .eq("report_id", reportId)
    .order("message_id", { ascending: false })
    .limit(1);
  if (!photos?.length || photos[0].message_id !== myMessageId) return; // 더 늦게 온 사진이 처리함

  await claimAndProcess(reportId);
}

// 여러 요청이 동시에 처리하려 해도 딱 하나만 잡도록 상태를 원자적으로 바꿈
async function claimAndProcess(reportId: string) {
  const supabase = createAdminClient();
  const { data: claimed } = await supabase
    .from("reports")
    .update({ status: "analyzing" })
    .eq("id", reportId)
    .eq("status", "collecting")
    .select("id, chat_id, reporter_name")
    .maybeSingle();
  if (!claimed) return;
  await analyzeAndAsk(claimed.id, claimed.chat_id, claimed.reporter_name ?? "직원");
}

// 처리 중 죽어서 멈춘 보고가 있으면 다시 살림 (다음 메시지가 올 때 호출)
export async function recoverStale(chatId: number) {
  const supabase = createAdminClient();
  const t20s = new Date(Date.now() - 20_000).toISOString();
  const t3m = new Date(Date.now() - 180_000).toISOString();

  // 3분 넘게 analyzing → 다시 collecting 으로
  await supabase
    .from("reports")
    .update({ status: "collecting" })
    .eq("chat_id", chatId)
    .eq("status", "analyzing")
    .lt("received_at", t3m);

  const { data: stale } = await supabase
    .from("reports")
    .select("id")
    .eq("chat_id", chatId)
    .eq("status", "collecting")
    .lt("received_at", t20s)
    .limit(3);
  for (const r of stale ?? []) await claimAndProcess(r.id);
}

// ---------- 3) 사진 내려받아 AI 분석 → 직원에게 확인 버튼 ----------
async function downloadTelegramImage(fileId: string): Promise<AiImage> {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const file = await tg<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`사진 다운로드 실패: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = file.file_path.toLowerCase();
  const media_type: AiImage["media_type"] = ext.endsWith(".png")
    ? "image/png"
    : ext.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { data: buf.toString("base64"), media_type };
}

// 접수 메시지가 있으면 그걸 결과로 바꾸고, 없으면 새로 보냄
async function showPrompt(
  chatId: number,
  ackMessageId: number | null,
  text: string,
  reply_markup: unknown,
): Promise<number> {
  if (ackMessageId && ackMessageId > 0) {
    try {
      await tg("editMessageText", { chat_id: chatId, message_id: ackMessageId, parse_mode: "HTML", text, reply_markup });
      return ackMessageId;
    } catch (e) {
      console.error("접수 메시지 수정 실패, 새로 보냄:", e);
    }
  }
  const sent = await tg<{ message_id: number }>("sendMessage", { chat_id: chatId, parse_mode: "HTML", text, reply_markup });
  return sent.message_id;
}

async function analyzeAndAsk(reportId: string, chatId: number, reporterName: string) {
  const t0 = Date.now();
  const supabase = createAdminClient();
  const { data: rep } = await supabase.from("reports").select("prompt_message_id").eq("id", reportId).maybeSingle();
  const ackId = (rep?.prompt_message_id as number | null) ?? null;
  const { data: photos } = await supabase
    .from("report_photos")
    .select("small_file_id")
    .eq("report_id", reportId)
    .order("message_id", { ascending: true });
  const count = photos?.length ?? 0;

  let analysis: Analysis | null = null;
  let usage: AiUsage | null = null;
  let model: string | null = null;

  if (process.env.ANTHROPIC_API_KEY && count > 0) {
    // 최대 2번 시도
    for (let attempt = 1; attempt <= 2 && !analysis; attempt++) {
      try {
        const images = await Promise.all(photos!.map((p) => downloadTelegramImage(p.small_file_id)));
        const tAi = Date.now();
        const r = await analyzePhotos(images, reporterName, await knownPlaces());
        console.log(`[report ${reportId}] AI ${Date.now() - tAi}ms`);
        analysis = r.analysis;
        usage = r.usage;
        model = r.model;
      } catch (e) {
        console.error(`AI 분석 실패 (${attempt}회):`, e);
        if (attempt < 2) await sleep(1500);
      }
    }
  }

  const { label, timeStr } = kstParts();
  let promptMessageId: number;

  if (analysis) {
    const isLow = analysis.confidence === "low" && analysis.question && analysis.question_options.length > 0;
    const confKo = { high: "높음", medium: "보통", low: "낮음" }[analysis.confidence];

    if (isLow) {
      // 애매함 → 질문 딱 1개, 버튼으로만 답
      const opts = analysis.question_options.slice(0, 4);
      promptMessageId = await showPrompt(
        chatId,
        ackId,
        `🙋 <b>하나만 확인할게요</b>\n${analysis.question}\n\n` +
          `<i>사진 ${count}장 · ${label} ${timeStr}</i>`,
        {
          inline_keyboard: [
            ...opts.map((o, i) => [{ text: o.label, callback_data: `r:${reportId}:o${i}` }]),
            [
              { text: "✏️ 직접 고르기", callback_data: `r:${reportId}:fix` },
              { text: "✖ 취소", callback_data: `r:${reportId}:x` },
            ],
          ],
        },
      );
    } else {
      promptMessageId = await showPrompt(
        chatId,
        ackId,
        `🤖 이렇게 보고할게요\n\n<b>${escapeHtml(analysis.report_text)}</b>\n\n` +
          `<i>사진 ${count}장 · ${label} ${timeStr} · 확신 ${confKo}</i>`,
        {
          inline_keyboard: [
            [{ text: "✅ 이대로 보고", callback_data: `r:${reportId}:ok` }],
            [
              { text: "✏️ 장소 고치기", callback_data: `r:${reportId}:fix` },
              { text: "✖ 취소", callback_data: `r:${reportId}:x` },
            ],
          ],
        },
      );
    }

    await supabase
      .from("reports")
      .update({
        status: "awaiting",
        place: analysis.place,
        task: analysis.task,
        confidence: analysis.confidence,
        report_text: analysis.report_text,
        ai_json: analysis,
        usage_json: usage,
        model,
        question_asked: !!isLow,
        prompt_message_id: promptMessageId,
        analyzed_at: new Date().toISOString(),
      })
      .eq("id", reportId);
  } else {
    // AI 없음/실패 → 예전 방식: 구역 버튼
    const mid = await showPrompt(
      chatId,
      ackId,
      `어느 구역이에요? 👇\n<i>사진 ${count}장 · ${label} ${timeStr}</i>`,
      areaKeyboard(reportId),
    );
    await supabase
      .from("reports")
      .update({ status: "awaiting", prompt_message_id: mid, analyzed_at: new Date().toISOString() })
      .eq("id", reportId);
  }
  console.log(`[report ${reportId}] 분석→버튼까지 ${Date.now() - t0}ms (사진 ${count}장, AI ${analysis ? "성공" : "없음"})`);
}

export function areaKeyboard(reportId: string, withTyping = false) {
  return {
    inline_keyboard: [
      ...AREAS.map((a, i) => [{ text: `🧹 ${a}`, callback_data: `r:${reportId}:a${i}` }]),
      ...(withTyping ? [[{ text: "✍️ 다른 장소 직접 입력", callback_data: `r:${reportId}:t` }]] : []),
      [{ text: "✖ 취소", callback_data: `r:${reportId}:x` }],
    ],
  };
}

// 보고문 조립 (장소를 직원이 정했을 때)
function composeText(place: string, ai: Analysis | null) {
  const task = ai?.task || "청소";
  const detail = ai?.action_summary?.trim();
  return detail ? `${place} ${task} 완료. ${detail}` : `${place} ${task} 완료.`;
}

// 직원이 글자로 장소를 답했을 때 (editing 상태인 보고가 있으면 그걸로 게시)
export async function handleTypedPlace(chatId: number, text: string): Promise<boolean> {
  const place = text.trim().slice(0, 40);
  if (!place || place.startsWith("/")) return false;
  const supabase = createAdminClient();
  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("chat_id", chatId)
    .eq("status", "editing")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!report) return false;
  const ai = report.ai_json as Analysis | null;
  const result = await postToGroup(report, place, composeText(place, ai));
  if (!result.includes("완료")) {
    await tg("sendMessage", { chat_id: chatId, text: result });
  }
  return true;
}

// 이 매장에서 실제로 보고된 장소들 (AI 에게 힌트로 줌 → 쓸수록 똑똑해짐)
export async function knownPlaces(): Promise<string[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("reports")
    .select("place")
    .eq("status", "posted")
    .gte("posted_at", since)
    .not("place", "is", null)
    .order("posted_at", { ascending: false })
    .limit(300);
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const p = (r.place as string).trim();
    if (!p || (AREAS as readonly string[]).includes(p)) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([p]) => p);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- 4) 버튼 처리 ----------
export type Decision =
  | { kind: "ok" }
  | { kind: "option"; index: number }
  | { kind: "fix" }
  | { kind: "area"; index: number }
  | { kind: "type" }
  | { kind: "cancel" };

export function parseCallback(data: string): { reportId: string; decision: Decision } | null {
  const m = /^r:([0-9a-f-]{36}):(ok|fix|x|t|o(\d)|a(\d))$/.exec(data);
  if (!m) return null;
  const reportId = m[1];
  const code = m[2];
  if (code === "ok") return { reportId, decision: { kind: "ok" } };
  if (code === "fix") return { reportId, decision: { kind: "fix" } };
  if (code === "x") return { reportId, decision: { kind: "cancel" } };
  if (code === "t") return { reportId, decision: { kind: "type" } };
  if (code.startsWith("o")) return { reportId, decision: { kind: "option", index: Number(m[3]) } };
  return { reportId, decision: { kind: "area", index: Number(m[4]) } };
}

export async function handleDecision(reportId: string, decision: Decision): Promise<string> {
  const supabase = createAdminClient();
  const { data: report } = await supabase.from("reports").select("*").eq("id", reportId).maybeSingle();
  if (!report) return "보고를 찾지 못했어요.";
  if (report.status === "posted") return "이미 보고됐어요.";
  if (report.status === "cancelled") return "취소된 보고예요.";
  if (report.status !== "awaiting" && report.status !== "editing") return "처리 중이에요. 잠시만요.";

  const ai = report.ai_json as Analysis | null;

  if (decision.kind === "cancel") {
    await supabase.from("reports").update({ status: "cancelled" }).eq("id", reportId);
    await editPrompt(report, "취소했어요. 다시 보고하려면 사진을 다시 보내주세요.");
    return "취소됨";
  }

  if (decision.kind === "fix") {
    await tg("editMessageText", {
      chat_id: report.chat_id,
      message_id: report.prompt_message_id,
      text: "어느 구역이에요? 👇",
      reply_markup: areaKeyboard(reportId, true),
    });
    return "";
  }

  if (decision.kind === "type") {
    await supabase.from("reports").update({ status: "editing" }).eq("id", reportId);
    await tg("editMessageText", {
      chat_id: report.chat_id,
      message_id: report.prompt_message_id,
      parse_mode: "HTML",
      text: "✍️ 장소 이름을 <b>답장으로</b> 보내주세요.\n예: 3층 헬스장 정수기\n\n<i>한 번 알려주면 다음부터 AI 가 기억해요</i>",
      reply_markup: { inline_keyboard: [[{ text: "✖ 취소", callback_data: `r:${reportId}:x` }]] },
    });
    return "";
  }

  let place = report.place as string | null;
  let text = report.report_text as string | null;

  if (decision.kind === "option") {
    const opt = ai?.question_options?.[decision.index];
    if (!opt) return "선택지를 찾지 못했어요.";
    text = opt.report_text;
    place = guessPlace(opt.label, opt.report_text) ?? place;
  } else if (decision.kind === "area") {
    const area = AREAS[decision.index];
    if (!area) return "알 수 없는 구역이에요.";
    place = area;
    text = composeText(area, ai);
  }
  if (!text) text = `${place ?? "업무"} 완료.`;

  return postToGroup(report, place, text);
}

function guessPlace(...candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = AREAS.find((a) => c.includes(a));
    if (hit) return hit;
  }
  return null;
}

async function editPrompt(report: { chat_id: number; prompt_message_id: number | null }, text: string) {
  if (!report.prompt_message_id) return;
  try {
    await tg("editMessageText", {
      chat_id: report.chat_id,
      message_id: report.prompt_message_id,
      parse_mode: "HTML",
      text,
    });
  } catch (e) {
    console.error("버튼 메시지 수정 실패:", e);
  }
}

// ---------- 5) 공용방 게시 ----------
async function postToGroup(
  report: { id: string; chat_id: number; prompt_message_id: number | null; reporter_name: string | null },
  place: string | null,
  text: string,
): Promise<string> {
  const supabase = createAdminClient();

  // 두 번 눌러도 한 번만 올라가게
  const { data: claimed } = await supabase
    .from("reports")
    .update({ status: "posting" })
    .eq("id", report.id)
    .in("status", ["awaiting", "editing"])
    .select("id")
    .maybeSingle();
  if (!claimed) return "이미 처리 중이에요.";

  const { data: photos } = await supabase
    .from("report_photos")
    .select("file_id")
    .eq("report_id", report.id)
    .order("message_id", { ascending: true });

  const now = new Date();
  const { label, timeStr } = kstParts(now);
  const caption = `🧹 <b>${escapeHtml(text)}</b>\n${label} ${timeStr} · ${report.reporter_name ?? "직원"}`;

  try {
    let ids: number[] = [];
    if (photos && photos.length > 0) {
      const media = photos.slice(0, 10).map((p, i) => ({
        type: "photo",
        media: p.file_id,
        ...(i === 0 ? { caption, parse_mode: "HTML" } : {}),
      }));
      const sent = await tg<{ message_id: number }[]>("sendMediaGroup", {
        chat_id: cleaningChatId(),
        media,
      });
      ids = sent.map((m) => m.message_id);
    } else {
      const sent = await tg<{ message_id: number }>("sendMessage", {
        chat_id: cleaningChatId(),
        parse_mode: "HTML",
        text: caption,
      });
      ids = [sent.message_id];
    }

    await supabase
      .from("reports")
      .update({
        status: "posted",
        place,
        report_text: text,
        group_message_ids: ids,
        posted_at: now.toISOString(),
      })
      .eq("id", report.id);

    await editPrompt(report, `✅ <b>보고 완료</b> (${timeStr})\n${escapeHtml(text)}`);

    // 오늘 전부 끝났으면 축하 한 줄
    const summary = await todaySummaryText();
    if (summary.includes("전부 완료")) {
      await tg("sendMessage", { chat_id: report.chat_id, parse_mode: "HTML", text: summary });
    }
    return "보고 완료!";
  } catch (e) {
    console.error("공용방 게시 실패:", e);
    // 다시 누를 수 있게 되돌림
    await supabase.from("reports").update({ status: "awaiting" }).eq("id", report.id);
    return "게시에 실패했어요. 잠시 후 다시 눌러주세요.";
  }
}

// ---------- 6) 오늘 현황 / 이번 달 비용 ----------
export async function todaySummaryText() {
  const supabase = createAdminClient();
  const { dateStr, startISO, endISO } = kstTodayRange();
  const { data } = await supabase
    .from("reports")
    .select("place, posted_at")
    .eq("status", "posted")
    .gte("posted_at", startISO)
    .lt("posted_at", endISO)
    .order("posted_at", { ascending: true });
  const { label } = kstParts(new Date(`${dateStr}T12:00:00+09:00`));
  return buildSummary((data ?? []) as PostedRow[], label).text;
}

export async function monthCostText() {
  const supabase = createAdminClient();
  const { dateStr } = kstParts();
  const monthStart = new Date(`${dateStr.slice(0, 7)}-01T00:00:00+09:00`).toISOString();
  const { data } = await supabase
    .from("reports")
    .select("model, usage_json")
    .not("usage_json", "is", null)
    .gte("received_at", monthStart);

  let usd = 0;
  let count = 0;
  const tot: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const r of data ?? []) {
    const u = r.usage_json as AiUsage;
    count++;
    usd += estimateUsd(r.model ?? "claude-opus-5", u);
    tot.input_tokens += u.input_tokens;
    tot.output_tokens += u.output_tokens;
    tot.cache_read_input_tokens += u.cache_read_input_tokens;
    tot.cache_creation_input_tokens += u.cache_creation_input_tokens;
  }
  const krw = Math.round(usd * 1400);
  const per = count ? Math.round((usd * 1400) / count) : 0;
  return (
    `💰 <b>이번 달 AI 비용 (추정)</b>\n` +
    `분석 ${count}건 · 약 $${usd.toFixed(2)} ≈ ${krw.toLocaleString()}원\n` +
    `건당 약 ${per}원\n\n` +
    `<i>입력 ${tot.input_tokens.toLocaleString()} · 캐시 ${tot.cache_read_input_tokens.toLocaleString()} · 출력 ${tot.output_tokens.toLocaleString()} 토큰\n` +
    `환율 1,400원 기준. 정확한 금액은 Anthropic 콘솔에서 확인</i>`
  );
}
