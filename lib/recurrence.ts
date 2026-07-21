// TimeTree식 반복 일정을, 보이는 달력 범위 안의 실제 날짜들로 펼쳐주는 계산기

export type RepeatType = "none" | "daily" | "weekly" | "monthly" | "yearly";

export type EventRow = {
  id: string;
  title: string;
  event_date: string; // 'YYYY-MM-DD'
  end_date: string | null;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  color: string;
  memo: string | null;
  repeat: RepeatType;
  repeat_until: string | null;
};

// 'YYYY-MM-DD' -> UTC 자정 Date (시간대 흔들림 방지)
function toUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Date -> 'YYYY-MM-DD'
export function ymd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 어떤 행사가 [rangeStart, rangeEnd] 안에서 열리는 날짜 목록을 돌려줌
export function occurrencesInRange(
  ev: EventRow,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const start = toUTC(rangeStart).getTime();
  const end = toUTC(rangeEnd).getTime();
  const anchor = toUTC(ev.event_date);
  const anchorTime = anchor.getTime();

  // 반복 종료일이 있으면 그 날까지만
  const hardEnd = ev.repeat_until
    ? Math.min(end, toUTC(ev.repeat_until).getTime())
    : end;

  // 반복 없음: 기준일이 범위 안이면 그 하루만
  if (ev.repeat === "none") {
    return anchorTime >= start && anchorTime <= end ? [ev.event_date] : [];
  }

  const out: string[] = [];
  const day = 24 * 60 * 60 * 1000;
  const anchorDom = anchor.getUTCDate(); // 매월 반복 기준일(1~31)
  const anchorMonth = anchor.getUTCMonth(); // 매년 반복 기준월
  let guard = 0; // 무한루프 방지

  if (ev.repeat === "daily" || ev.repeat === "weekly") {
    const step = (ev.repeat === "daily" ? 1 : 7) * day;
    // 범위 시작 이후 첫 회차로 점프
    let t = anchorTime;
    if (t < start) {
      const skips = Math.ceil((start - t) / step);
      t += skips * step;
    }
    while (t <= hardEnd && guard++ < 2000) {
      if (t >= anchorTime) out.push(ymd(new Date(t)));
      t += step;
    }
    return out;
  }

  if (ev.repeat === "monthly") {
    // 기준일의 '일'을 유지하며 매달. 그 달에 그 날이 없으면(예: 31일) 건너뜀
    let y = anchor.getUTCFullYear();
    let m = anchor.getUTCMonth();
    while (guard++ < 600) {
      const d = new Date(Date.UTC(y, m, anchorDom));
      // 달을 넘겨버렸으면(그 달에 그 날 없음) 그 달은 건너뜀
      if (d.getUTCMonth() === ((m % 12) + 12) % 12) {
        const t = d.getTime();
        if (t > hardEnd) break;
        if (t >= start && t >= anchorTime) out.push(ymd(d));
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      if (Date.UTC(y, m, 1) > hardEnd) break;
    }
    return out;
  }

  if (ev.repeat === "yearly") {
    let y = anchor.getUTCFullYear();
    while (guard++ < 200) {
      const d = new Date(Date.UTC(y, anchorMonth, anchorDom));
      if (d.getUTCMonth() === anchorMonth) {
        // 2/29 같은 날은 평년엔 건너뜀
        const t = d.getTime();
        if (t > hardEnd) break;
        if (t >= start && t >= anchorTime) out.push(ymd(d));
      }
      y += 1;
      if (Date.UTC(y, anchorMonth, 1) > hardEnd) break;
    }
    return out;
  }

  return out;
}

// 색상 팔레트 (키 -> 화면 표시용 클래스)
export const EVENT_COLORS: Record<
  string,
  { dot: string; chip: string; label: string }
> = {
  blue: { dot: "bg-blue-500", chip: "bg-blue-100 text-blue-700", label: "파랑" },
  green: {
    dot: "bg-green-500",
    chip: "bg-green-100 text-green-700",
    label: "초록",
  },
  red: { dot: "bg-red-500", chip: "bg-red-100 text-red-700", label: "빨강" },
  amber: {
    dot: "bg-amber-500",
    chip: "bg-amber-100 text-amber-700",
    label: "노랑",
  },
  purple: {
    dot: "bg-purple-500",
    chip: "bg-purple-100 text-purple-700",
    label: "보라",
  },
  gray: { dot: "bg-gray-500", chip: "bg-gray-200 text-gray-700", label: "회색" },
};

export const REPEAT_LABELS: Record<RepeatType, string> = {
  none: "반복 없음",
  daily: "매일",
  weekly: "매주",
  monthly: "매월",
  yearly: "매년",
};
