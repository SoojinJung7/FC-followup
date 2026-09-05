-- ============================================================
-- 청소 보고 기록표
-- Supabase 대시보드 > SQL Editor 에 그대로 붙여넣고 RUN 하면 됨
-- ============================================================

create table if not exists cleaning_logs (
  id uuid primary key default gen_random_uuid(),
  area text not null,                        -- 구역 이름 (예: 3층 락커)
  reported_at timestamptz not null default now(), -- 보고 시각
  reporter_id bigint,                        -- 텔레그램 사용자 숫자 id
  reporter_name text,                        -- 텔레그램 이름
  photo_file_id text not null,               -- 텔레그램 사진 id (다시 보낼 때 씀)
  group_message_id bigint,                   -- 보고방에 올라간 메시지 번호
  created_at timestamptz not null default now()
);

create index if not exists cleaning_logs_reported_at_idx
  on cleaning_logs (reported_at desc);

-- 서버(service_role)만 쓰는 표라서 일반 사용자는 접근 불가
alter table cleaning_logs enable row level security;
create policy "logged_in_read_cleaning_logs" on cleaning_logs
  for select to authenticated using (true);
