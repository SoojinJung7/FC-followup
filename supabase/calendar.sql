-- ============================================================
-- FC-followup 캘린더(행사 일정) 표 추가
-- Supabase > SQL Editor 에 붙여넣고 RUN
-- ============================================================

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,                       -- 행사 이름
  event_date date not null,                  -- 시작 날짜 (반복이면 첫 회 기준일)
  end_date date,                             -- 종료 날짜 (여러 날 행사, 선택)
  all_day boolean not null default true,     -- 하루종일 여부
  start_time text,                           -- 시작 시간 'HH:MM' (하루종일이면 비움)
  end_time text,                             -- 종료 시간 'HH:MM'
  color text not null default 'blue',        -- 색상 키 (blue/green/red/amber/purple/gray)
  memo text,                                 -- 메모
  repeat text not null default 'none',       -- none/daily/weekly/monthly/yearly
  repeat_until date,                         -- 반복 종료일 (없으면 계속)
  created_by uuid,                           -- 만든 사람 (auth uid)
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx on events (event_date);

-- 보안: 로그인한 사람만 보고/쓰기
alter table events enable row level security;
create policy "logged_in_all_events" on events
  for all to authenticated using (true) with check (true);
