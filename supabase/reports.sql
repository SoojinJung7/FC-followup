-- ============================================================
-- 사진 업무보고 기록표 (AI 분석 버전)
-- Supabase 대시보드 > SQL Editor 에 그대로 붙여넣고 RUN 하면 됨
-- ============================================================

-- 1) 보고 1건 = 사진 묶음 1개
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,                   -- 직원과 봇의 1:1 대화방 번호
  media_group_id text not null,              -- 텔레그램 앨범 id (한 장이면 'single:<message_id>')
  reporter_id bigint,                        -- 텔레그램 사용자 숫자 id
  reporter_name text,
  status text not null default 'collecting', -- collecting(사진 모으는 중) → analyzing(AI 분석 중)
                                             -- → awaiting(직원 확인 대기) → posting → posted(게시 완료)
                                             -- / cancelled(취소) / failed(실패)
  place text,                                -- AI 또는 직원이 정한 장소
  task text,                                 -- 업무 종류 (청소/정리/…)
  confidence text,                           -- high / medium / low / null(AI 없이 처리)
  report_text text,                          -- 공용방에 올라갈 보고 문장
  ai_json jsonb,                             -- AI 원본 응답
  usage_json jsonb,                          -- 토큰 사용량 (비용 계산용)
  model text,                                -- 사용한 AI 모델
  question_asked boolean not null default false,
  prompt_message_id bigint,                  -- 직원 DM에 띄운 버튼 메시지 번호
  group_message_ids jsonb,                   -- 공용방에 올라간 메시지 번호들
  received_at timestamptz not null default now(),  -- 서버가 첫 사진 받은 시각 (서버 타임스탬프)
  analyzed_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chat_id, media_group_id)
);

create index if not exists reports_posted_at_idx on reports (posted_at desc);
create index if not exists reports_status_idx on reports (status);

-- 2) 보고에 속한 사진들
create table if not exists report_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  message_id bigint not null,                -- 텔레그램 메시지 번호 (순서 유지용)
  file_id text not null,                     -- 원본(가장 큰) 사진 id → 공용방 게시에 사용
  small_file_id text not null,               -- 약 800px 사진 id → AI 분석에 사용 (비용 절감)
  width int, height int,
  created_at timestamptz not null default now(),
  unique (report_id, message_id)
);

-- 서버(service_role)만 쓰는 표. 로그인 사용자는 읽기만.
alter table reports enable row level security;
alter table report_photos enable row level security;
create policy "logged_in_read_reports" on reports
  for select to authenticated using (true);
create policy "logged_in_read_report_photos" on report_photos
  for select to authenticated using (true);
