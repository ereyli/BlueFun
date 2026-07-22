"use client";

import { createClient, type RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

type RealtimeRow = Record<string, unknown>;

export function useRealtimeRefresh(input: {
  table: string;
  filter?: string;
  fallbackMs?: number;
  onRefresh: () => void | Promise<void>;
  matches?: (payload: RealtimePostgresChangesPayload<RealtimeRow>) => boolean;
}) {
  const callbackRef = useRef(input.onRefresh);
  const matchesRef = useRef(input.matches);
  callbackRef.current = input.onRefresh;
  matchesRef.current = input.matches;

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let subscribed = false;
    let debounceTimer: number | undefined;

    const refreshVisible = () => {
      if (document.visibilityState === "visible") void callbackRef.current();
    };
    const queueRefresh = (payload?: RealtimePostgresChangesPayload<RealtimeRow>) => {
      if (payload && matchesRef.current && !matchesRef.current(payload)) return;
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(refreshVisible, 300);
    };

    const fallbackTimer = window.setInterval(() => {
      // Realtime is primary. The slower fallback heals missed websocket messages.
      if (!subscribed || document.visibilityState === "visible") refreshVisible();
    }, input.fallbackMs ?? 60_000);
    document.addEventListener("visibilitychange", refreshVisible);

    if (!supabaseUrl || !supabaseAnonKey) {
      return () => {
        window.clearInterval(fallbackTimer);
        window.clearTimeout(debounceTimer);
        document.removeEventListener("visibilitychange", refreshVisible);
      };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    const channel = supabase
      .channel(`refresh-${input.table}-${shortHash(input.filter || "all")}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: input.table, ...(input.filter ? { filter: input.filter } : {}) },
        queueRefresh
      )
      .subscribe((status) => {
        subscribed = status === "SUBSCRIBED";
      });

    return () => {
      subscribed = false;
      window.clearInterval(fallbackTimer);
      window.clearTimeout(debounceTimer);
      document.removeEventListener("visibilitychange", refreshVisible);
      void supabase.removeChannel(channel);
    };
  }, [input.fallbackMs, input.filter, input.table]);
}

function shortHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  return Math.abs(hash).toString(36);
}
