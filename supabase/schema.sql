-- ============================================================
-- FC-followup 데이터 설계도
-- Supabase 대시보드 > SQL Editor 에 그대로 붙여넣고 RUN 하면 됨
-- ============================================================

-- 1) 부서원 명단
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  name text not null,                       -- 이름 (예: 김철수)
  telegram_username text,                    -- 텔레그램 아이디 (@ 없이, 선택)
  telegram_user_id bigint,                   -- 텔레그램 숫자 id (콕 집어 알림 보낼 때, 선택)
  active boolean not null default true,      -- 재직중 여부
  created_at timestamptz not null default now()
);

-- 2) 반복 업무 (지금은 '포스터 붙이기' 하나)
create table if not exists duties (
  id uuid primary key default gen_random_uuid(),
  title text not null,                       -- 업무 이름
  day_of_month int not null default 1,       -- 매월 며칠에 하는 일인지 (1 = 1일)
  remind_days int not null default 2,        -- 며칠간 리마인드할지 (2 = 이틀)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3) 월별 담당자 지정
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  duty_id uuid not null references duties(id) on delete cascade,
  year int not null,                         -- 연도 (예: 2026)
  month int not null,                        -- 월 (1~12)
  member_id uuid references members(id) on delete set null,
  status text not null default 'pending',    -- pending(대기) / done(완료)
  completed_at timestamptz,                   -- 완료 표시한 시각
  created_at timestamptz not null default now(),
  unique (duty_id, year, month)              -- 한 업무는 한 달에 한 명만
);

-- 처음 한 번: 포스터 붙이기 업무 등록 (이미 있으면 무시)
insert into duties (title, day_of_month, remind_days)
select '매월 1일 포스터 붙이기', 1, 2
where not exists (select 1 from duties);

-- ============================================================
-- 보안 규칙 (RLS): 로그인한 사람만 보고/고칠 수 있게
-- ============================================================
alter table members enable row level security;
alter table duties enable row level security;
alter table assignments enable row level security;

-- 로그인한(authenticated) 사용자는 전부 읽고 쓸 수 있음 (내부 8~12명용)
create policy "logged_in_all_members" on members
  for all to authenticated using (true) with check (true);
create policy "logged_in_all_duties" on duties
  for all to authenticated using (true) with check (true);
create policy "logged_in_all_assignments" on assignments
  for all to authenticated using (true) with check (true);
