import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/lib/recurrence";
import CalendarView from "./CalendarView";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: events } = await supabase
    .from("events")
    .select("*")
    .order("event_date");

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">행사 캘린더</h1>
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← 업무 팔로업
        </Link>
      </header>

      <CalendarView events={(events ?? []) as EventRow[]} />
    </main>
  );
}
