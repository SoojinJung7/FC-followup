import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 구글 로그인 후 돌아오는 곳: 임시 코드를 진짜 로그인 세션으로 바꿈
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=1`);
}
