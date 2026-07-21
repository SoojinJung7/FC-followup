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
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">FC 팔로업</h1>
          <p className="text-sm text-gray-500">
            {year}년 {month}월 · {user.email}
          </p>
        </div>
        <form action={signOut}>
          <button className="text-sm text-gray-400 hover:text-gray-600">
            로그아웃
          </button>
        </form>
      </header>

      {/* 업무 카드들 */}
      <section className="space-y-4">
        {(duties ?? []).map((duty) => {
          const a = assignmentFor(duty.id);
          const done = a?.status === "done";
          return (
            <div
              key={duty.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">{duty.title}</h2>
                  <p className="mt-0.5 text-xs text-gray-400">
                    매월 {duty.day_of_month}일 · {duty.remind_days}일간 리마인드
                  </p>
                </div>
                {done ? (
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                    완료 ✅
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
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
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">— 담당자 선택 —</option>
                  {(members ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
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
                    className={`w-full rounded-lg py-2 text-sm font-medium ${
                      done
                        ? "bg-gray-100 text-gray-500 hover:bg-gray-200"
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
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm"
            >
              <span className="text-gray-800">
                {m.name}
                {m.telegram_username && (
                  <span className="ml-2 text-xs text-gray-400">
                    @{m.telegram_username}
                  </span>
                )}
              </span>
              <form action={removeMember}>
                <input type="hidden" name="id" value={m.id} />
                <button className="text-xs text-gray-400 hover:text-red-500">
                  삭제
                </button>
              </form>
            </div>
          ))}
          {(members ?? []).length === 0 && (
            <p className="text-sm text-gray-400">
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
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="telegram_username"
            placeholder="텔레그램 아이디(선택)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            추가
          </button>
        </form>
      </section>

      {/* 테스트 알림 */}
      <section className="mt-8 border-t border-gray-100 pt-6">
        <form action={sendTestMessage}>
          <button className="text-sm text-blue-600 hover:text-blue-800">
            🔔 단톡방에 테스트 알림 보내기
          </button>
        </form>
      </section>
    </main>
  );
}
