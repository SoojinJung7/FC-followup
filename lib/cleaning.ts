// ============================================================
// 청소 보고 봇 - 공통 설정과 도우미
// 구역 목록을 바꾸고 싶으면 아래 AREAS 만 고치면 됨
// ============================================================

// 층별 구역 (버튼 순서 = 자주 보고되는 순: 3층 → 3.5층 → …)
export const FLOORS: { floor: string; places: string[] }[] = [
  {
    floor: "3층",
    places: [
      "3층 헬스장 A존", "3층 헬스장 B존", "3층 헬스장 트레드밀", "3층 헬스장 사이클",
      "3층 헬스장 정수기", "3층 헬스장 스트레칭존", "3층 헬스장 여자화장실", "3층 헬스장 창틀",
      "3층 헬스장 데스크", "3층 헬스장 GX룸", "3층 헬스장 전반적",
    ],
  },
  { floor: "3.5층", places: ["3.5층 필라테스 교육장", "3.5층 1:1 필라테스룸", "3.5층 서클필립", "3.5층 대강당"] },
  { floor: "4층", places: ["4층 1:1 PT룸", "4층 유소년카운터", "4층 복도", "4층 사무실"] },
  { floor: "1층", places: ["1층"] },
  { floor: "L층", places: ["L층 로비층", "L층 여사우나"] },
  { floor: "G층", places: ["G층 골프장"] },
  { floor: "P1", places: ["P1 주차장"] },
  { floor: "P2", places: ["P2 주차장"] },
];
export const AREAS: readonly string[] = FLOORS.flatMap((f) => f.places);

// 장소 이름에서 층 찾기 ("3층 헬스장 정수기" → "3층"), 못 찾으면 "기타"
export function floorOf(place: string): string {
  const hit = FLOORS.find((f) => place.startsWith(f.floor));
  return hit ? hit.floor : "기타";
}
// 버튼용 짧은 이름 ("3층 헬스장 정수기" → "헬스장 정수기")
export function shortName(place: string): string {
  const f = floorOf(place);
  const rest = place.startsWith(f) ? place.slice(f.length).trim() : place;
  return rest || place;
}

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

export type PostedRow = {
  place: string | null;
  posted_at: string | null;
};

// 오늘 보고 요약 (HTML): 층별로 묶어서 보여줌
export function buildSummary(rows: PostedRow[], dateLabel: string) {
  const byFloor = new Map<string, string[]>();
  let count = 0;
  for (const r of rows) {
    if (!r.place || !r.posted_at) continue;
    count++;
    const { timeStr } = kstParts(new Date(r.posted_at));
    const f = floorOf(r.place);
    const list = byFloor.get(f) ?? [];
    list.push(`${shortName(r.place)} <i>${timeStr}</i>`);
    byFloor.set(f, list);
  }
  const lines = [`🧹 <b>오늘 업무 보고</b> · ${dateLabel}`, `총 <b>${count}</b>건`, ""];
  if (count === 0) lines.push("아직 보고가 없어요.");
  const order = [...FLOORS.map((f) => f.floor), "기타"];
  for (const f of order) {
    const list = byFloor.get(f);
    if (!list) continue;
    lines.push(`<b>${f}</b> (${list.length}건)`);
    for (const item of list) lines.push(` · ${item}`);
  }
  return { text: lines.join("\n"), count };
}
