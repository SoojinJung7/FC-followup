import { createClient } from "@supabase/supabase-js";

// 서버 뒤편(Cron)에서 로그인 없이 데이터를 읽을 때 쓰는 관리자 연결
// service_role 열쇠는 절대 브라우저로 나가면 안 됨 (서버 전용)
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
