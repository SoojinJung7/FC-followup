import { createBrowserClient } from "@supabase/ssr";

// 브라우저(화면)에서 Supabase에 접속할 때 쓰는 연결
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
