// ============================================================
// 청소 보고 봇 - 공통 설정과 도우미
// 구역 목록을 바꾸고 싶으면 아래 AREAS 만 고치면 됨
// ============================================================

export const AREAS = ["1층 로비", "2층 샤워실", "3층 락커"] as const;

// 텔레그램 API 를 한 번에 부르는 도우미 (sendPhoto, editMessageText 등 아무 메서드나)
export async function tg<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN 이 설정되지 않았습니다.");

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`텔레그램 ${method} 실패: ${JSON.stringify(data)}`);
  }
  return data.result as T;
}

// 청소 보고가 올라갈 방 (CLEANING_CHAT_ID). 설정 전에는 아무 방에도 안 올림
export function cleaningChatId(): string {
  const id = process.env.CLEANING_CHAT_ID;
  if (!id) throw new Error("CLEANING_CHAT_ID 가 설정되지 않았습니다.");
  return id;
}

// 한국 시간 기준 날짜/시각 문자열
const KST = "Asia/Seoul";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function kstParts(d: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p = Object.fromEntries(
    fmt.formatToParts(d).map((x) => [x.type, x.value]),
  );
  const dateStr = `${p.year}-${p.month}-${p.day}`; // 'YYYY-MM-DD'
  const weekdayIdx = new Date(`${dateStr}T00:00:00+09:00`).getUTCDay();
  const hour = p.hour === "24" ? "00" : p.hour;
  return {
    dateStr,
    timeStr: `${hour}:${p.minute}`, // 'HH:MM'
    label: `${p.year}-${p.month}-${p.day} (${WEEKDAYS[weekdayIdx]})`,
  };
}

// 오늘(KST) 하루의 시작과 끝을 UTC ISO 로 (DB 조회용)
export function kstTodayRange(d: Date = new Date()) {
  const { dateStr } = kstParts(d);
  const start = new Date(`${dateStr}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { dateStr, startISO: start.toISOString(), endISO: end.toISOString() };
}

export type CleaningLog = {
  area: string;
  reported_at: string;
  reporter_name: string | null;
};

// 오늘 완료/미완료 요약 글 만들기 (HTML)
export function buildSummary(logs: CleaningLog[], dateLabel: string) {
  const doneMap = new Map<string, string>(); // 구역 -> 마지막 보고 시각
  for (const l of logs) {
    const { timeStr } = kstParts(new Date(l.reported_at));
    doneMap.set(l.area, timeStr);
  }
  const done = AREAS.filter((a) => doneMap.has(a));
  const left = AREAS.filter((a) => !doneMap.has(a));

  const lines = [`🧹 <b>오늘 청소 현황</b> · ${dateLabel}`, ""];
  for (const a of AREAS) {
    lines.push(doneMap.has(a) ? `✅ ${a}  <i>${doneMap.get(a)}</i>` : `⬜ ${a}`);
  }
  lines.push("");
  lines.push(
    left.length === 0
      ? `🎉 ${AREAS.length}곳 전부 완료!`
      : `${done.length}/${AREAS.length} 완료 · 남은 곳: ${left.join(", ")}`,
  );
  return { text: lines.join("\n"), done, left };
}
