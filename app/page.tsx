import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  addMember,
  removeMember,
  assignMember,
  toggleDone,
  sendTestMessage,
  signOut,
} from "./actions";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 한국 시간 기준 이번 달
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  );
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // 데이터 가져오기
  const { data: duties } = await supabase
    .from("duties")
    .select("*")
    .eq("active", true)
    .order("created_at");

  const { data: members } = await supabase
    .from("members")
    .select("*")
    .eq("active", true)
    .order("name");

  const { data: assignments } = await supabase
    .from("assignments")
    .select("*")
    .eq("year", year)
    .eq("month", month);

  const assignmentFor = (dutyId: string) =>
    assignments?.find((a) => a.duty_id === dutyId);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      {/* 헤더 */}
      <header className="glass glass-header mb-6 flex items-center justify-between rounded-2xl px-5 py-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">FC 팔로업</h1>
          <p className="text-sm text-gray-500">
            {year}년 {month}월 · {user.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/calendar"
            className="text-sm font-medium text-orange-600 hover:text-orange-700"
          >
            📅 행사 캘린더
          </a>
          <form action={signOut}>
            <button className="text-sm text-gray-500 hover:text-gray-700">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      {/* 업무 카드들 */}
      <section className="space-y-4">
        {(duties ?? []).map((duty) => {
          const a = assignmentFor(duty.id);
          const done = a?.status === "done";
          return (
            <div
              key={duty.id}
              className="glass rounded-2xl p-5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">{duty.title}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    매월 {duty.day_of_month}일 · {duty.remind_days}일간 리마인드
                  </p>
                </div>
                {done ? (
                  <span className="rounded-full bg-green-100/80 px-3 py-1 text-xs font-medium text-green-700">
                    완료 ✅
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100/80 px-3 py-1 text-xs font-medium text-amber-700">
                    대기중
                  </span>
                )}
              </div>

              {/* 담당자 지정 */}
              <form action={assignMember} className="mt-4 flex gap-2">
                <input type="hidden" name="duty_id" value={duty.id} />
                <input type="hidden" name="year" value={year} />
                <input type="hidden" name="month" value={month} />
                <select
                  name="member_id"
                  defaultValue={a?.member_id ?? ""}
                  className="flex-1 rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-gray-800 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/40"
                >
                  <option value="">— 담당자 선택 —</option>
                  {(members ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button className="brand-grad brand-grad-hover rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm">
                  지정
                </button>
              </form>

              {/* 완료 토글 */}
              {a?.member_id && (
                <form action={toggleDone} className="mt-3">
                  <input type="hidden" name="id" value={a.id} />
                  <input
                    type="hidden"
                    name="next_status"
                    value={done ? "pending" : "done"}
                  />
                  <button
                    className={`w-full rounded-xl py-2 text-sm font-medium ${
                      done
                        ? "bg-white/60 text-gray-600 hover:bg-white/80"
                        : "bg-green-600 text-white hover:bg-green-500"
                    }`}
                  >
                    {done ? "완료 취소" : "완료로 표시"}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </section>

      {/* 부서원 명단 */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          부서원 명단
        </h2>
        <div className="space-y-2">
          {(members ?? []).map((m) => (
            <div
              key={m.id}
              className="glass flex items-center justify-between rounded-xl px-4 py-2 text-sm"
            >
              <span className="text-gray-800">
                {m.name}
                {m.telegram_username && (
                  <span className="ml-2 text-xs text-gray-500">
                    @{m.telegram_username}
                  </span>
                )}
              </span>
              <form action={removeMember}>
                <input type="hidden" name="id" value={m.id} />
                <button className="text-xs text-gray-500 hover:text-red-500">
                  삭제
                </button>
              </form>
            </div>
          ))}
          {(members ?? []).length === 0 && (
            <p className="text-sm text-gray-500">
              아직 부서원이 없어요. 아래에서 추가하세요.
            </p>
          )}
        </div>

        {/* 부서원 추가 */}
        <form action={addMember} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="이름"
            required
            className="flex-1 rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/40"
          />
          <input
            name="telegram_username"
            placeholder="텔레그램 아이디(선택)"
            className="flex-1 rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/40"
          />
          <button className="brand-grad brand-grad-hover rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm">
            추가
          </button>
        </form>
      </section>

      {/* 테스트 알림 */}
      <section className="mt-8 border-t border-white/40 pt-6">
        <form action={sendTestMessage}>
          <button className="text-sm text-orange-600 hover:text-orange-700">
            🔔 단톡방에 테스트 알림 보내기
          </button>
        </form>
      </section>
    </main>
  );
}
