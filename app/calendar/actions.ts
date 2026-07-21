"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// 폼 값 -> 저장할 행사 데이터로 정리
function parseEvent(formData: FormData) {
  const allDay = formData.get("all_day") === "on";
  return {
    title: String(formData.get("title") ?? "").trim(),
    event_date: String(formData.get("event_date") ?? ""),
    end_date: String(formData.get("end_date") ?? "") || null,
    all_day: allDay,
    start_time: allDay ? null : String(formData.get("start_time") ?? "") || null,
    end_time: allDay ? null : String(formData.get("end_time") ?? "") || null,
    color: String(formData.get("color") ?? "blue"),
    memo: String(formData.get("memo") ?? "").trim() || null,
    repeat: String(formData.get("repeat") ?? "none"),
    repeat_until: String(formData.get("repeat_until") ?? "") || null,
  };
}

export async function addEvent(formData: FormData) {
  const { supabase, user } = await requireUser();
  const ev = parseEvent(formData);
  if (!ev.title || !ev.event_date) return;
  await supabase.from("events").insert({ ...ev, created_by: user.id });
  revalidatePath("/calendar");
}

export async function updateEvent(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const ev = parseEvent(formData);
  if (!ev.title || !ev.event_date) return;
  await supabase.from("events").update(ev).eq("id", id);
  revalidatePath("/calendar");
}

export async function deleteEvent(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase.from("events").delete().eq("id", id);
  revalidatePath("/calendar");
}
