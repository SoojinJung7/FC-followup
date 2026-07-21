"use client";

import { useMemo, useState, useTransition } from "react";
import {
  occurrencesInRange,
  ymd,
  EVENT_COLORS,
  REPEAT_LABELS,
  type EventRow,
  type RepeatType,
} from "@/lib/recurrence";
import { addEvent, updateEvent, deleteEvent } from "./actions";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// KST 기준 오늘 'YYYY-MM-DD'
function kstToday(): string {
  const k = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${k.getFullYear()}-${pad(k.getMonth() + 1)}-${pad(k.getDate())}`;
}

export default function CalendarView({ events }: { events: EventRow[] }) {
  const today = kstToday();
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm); // 1~12

  const [dialog, setDialog] = useState<{
    editing: EventRow | null;
    date: string;
  } | null>(null);

  // 이번 달 6주 격자의 시작/끝 날짜
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const gridStartDate = new Date(Date.UTC(year, month - 1, 1 - firstDow));
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(ymd(new Date(gridStartDate.getTime() + i * 86400000)));
  }
  const gridStart = cells[0];
  const gridEnd = cells[41];

  // 날짜별 행사 모으기 (반복 펼치기)
  const byDate = useMemo(() => {
    const map: Record<string, EventRow[]> = {};
    for (const ev of events) {
      for (const d of occurrencesInRange(ev, gridStart, gridEnd)) {
        (map[d] ??= []).push(ev);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, gridStart, gridEnd]);

  function move(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  return (
    <div>
      {/* 월 이동 */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => move(-1)}
          className="rounded-lg px-3 py-1.5 text-gray-500 hover:bg-gray-100"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-gray-900">
            {year}년 {month}월
          </span>
          <button
            onClick={() => {
              setYear(ty);
              setMonth(tm);
            }}
            className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
          >
            오늘
          </button>
        </div>
        <button
          onClick={() => move(1)}
          className="rounded-lg px-3 py-1.5 text-gray-500 hover:bg-gray-100"
        >
          ›
        </button>
      </div>

      {/* 요일 */}
      <div className="grid grid-cols-7 border-b border-gray-100 pb-1 text-center text-xs font-medium text-gray-400">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : ""}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 날짜 격자 */}
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const dayNum = Number(d.slice(8, 10));
          const inMonth = Number(d.slice(5, 7)) === month;
          const isToday = d === today;
          const list = byDate[d] ?? [];
          return (
            <button
              key={d}
              onClick={() => setDialog({ editing: null, date: d })}
              className={`min-h-[76px] border-b border-r border-gray-100 p-1 text-left align-top transition hover:bg-gray-50 ${
                inMonth ? "" : "bg-gray-50/50"
              }`}
            >
              <div
                className={`mb-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? "bg-gray-900 font-bold text-white"
                    : inMonth
                      ? "text-gray-700"
                      : "text-gray-300"
                }`}
              >
                {dayNum}
              </div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id + d}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDialog({ editing: ev, date: d });
                    }}
                    className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                      EVENT_COLORS[ev.color]?.chip ?? EVENT_COLORS.blue.chip
                    }`}
                  >
                    {!ev.all_day && ev.start_time ? `${ev.start_time} ` : ""}
                    {ev.title}
                  </div>
                ))}
                {list.length > 3 && (
                  <div className="px-1 text-[10px] text-gray-400">
                    +{list.length - 3}개 더
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 행사 추가 버튼 */}
      <button
        onClick={() => setDialog({ editing: null, date: today })}
        className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white hover:bg-gray-700"
      >
        ＋ 행사 추가
      </button>

      {dialog && (
        <EventDialog
          editing={dialog.editing}
          date={dialog.date}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// ---------- 행사 등록/수정 창 ----------
function EventDialog({
  editing,
  date,
  onClose,
}: {
  editing: EventRow | null;
  date: string;
  onClose: () => void;
}) {
  const [allDay, setAllDay] = useState(editing ? editing.all_day : true);
  const [repeat, setRepeat] = useState<RepeatType>(editing?.repeat ?? "none");
  const [color, setColor] = useState(editing?.color ?? "blue");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      if (editing) await updateEvent(formData);
      else await addEvent(formData);
      onClose();
    });
  }
  function remove() {
    if (!editing) return;
    const fd = new FormData();
    fd.set("id", editing.id);
    startTransition(async () => {
      await deleteEvent(fd);
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        action={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
      >
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <input type="hidden" name="color" value={color} />

        <h2 className="mb-4 text-base font-semibold text-gray-900">
          {editing ? "행사 수정" : "행사 추가"}
        </h2>

        {/* 제목 */}
        <input
          name="title"
          placeholder="행사 제목"
          required
          defaultValue={editing?.title ?? ""}
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        {/* 색상 */}
        <div className="mb-3 flex gap-2">
          {Object.entries(EVENT_COLORS).map(([key, c]) => (
            <button
              key={key}
              type="button"
              onClick={() => setColor(key)}
              className={`h-6 w-6 rounded-full ${c.dot} ${
                color === key ? "ring-2 ring-gray-900 ring-offset-1" : ""
              }`}
              aria-label={c.label}
            />
          ))}
        </div>

        {/* 날짜 */}
        <div className="mb-3 flex items-center gap-2">
          <input
            type="date"
            name="event_date"
            required
            defaultValue={editing?.event_date ?? date}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <span className="text-gray-400">~</span>
          <input
            type="date"
            name="end_date"
            defaultValue={editing?.end_date ?? ""}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {/* 하루종일 / 시간 */}
        <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            name="all_day"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          하루종일
        </label>
        {!allDay && (
          <div className="mb-3 flex items-center gap-2">
            <input
              type="time"
              name="start_time"
              defaultValue={editing?.start_time ?? "09:00"}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="text-gray-400">~</span>
            <input
              type="time"
              name="end_time"
              defaultValue={editing?.end_time ?? "10:00"}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        {/* 반복 */}
        <div className="mb-3 flex items-center gap-2">
          <select
            name="repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as RepeatType)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {(Object.keys(REPEAT_LABELS) as RepeatType[]).map((k) => (
              <option key={k} value={k}>
                {REPEAT_LABELS[k]}
              </option>
            ))}
          </select>
          {repeat !== "none" && (
            <input
              type="date"
              name="repeat_until"
              defaultValue={editing?.repeat_until ?? ""}
              title="반복 종료일 (선택)"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          )}
        </div>
        {repeat !== "none" && (
          <p className="mb-3 -mt-1 text-xs text-gray-400">
            반복 종료일을 비우면 계속 반복돼요.
          </p>
        )}

        {/* 메모 */}
        <textarea
          name="memo"
          placeholder="메모 (선택)"
          defaultValue={editing?.memo ?? ""}
          rows={2}
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        {/* 버튼 */}
        <div className="flex items-center gap-2">
          {editing && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-lg px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50"
            >
              삭제
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {pending ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
