import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// 서버(뒤편)에서 Supabase에 접속할 때 쓰는 연결 - 로그인 상태를 쿠키로 기억
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출되면 무시 (middleware가 대신 갱신)
          }
        },
      },
    },
  );
}
