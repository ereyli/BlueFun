"use client";

import { useEffect, useRef, useState } from "react";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";

type ImageState = {
  source: string;
  attempt: number;
  failed: boolean;
  retrying: boolean;
};

export function useReliableTokenImage(source?: string) {
  return useReliableImage(source, optimizedTokenImageUrl);
}

export function useReliableImage(source?: string, resolve: (value?: string) => string | undefined = directImageUrl) {
  const normalizedSource = source || "";
  const retryTimer = useRef<number | undefined>(undefined);
  const [imageState, setImageState] = useState<ImageState>({
    source: normalizedSource,
    attempt: 0,
    failed: false,
    retrying: false
  });
  const state = imageState.source === normalizedSource
    ? imageState
    : { source: normalizedSource, attempt: 0, failed: false, retrying: false };
  const baseUrl = resolve(normalizedSource) || "";
  const url = state.attempt > 0 && baseUrl
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}retry=${state.attempt}`
    : baseUrl;

  useEffect(() => () => window.clearTimeout(retryTimer.current), [normalizedSource]);

  function onError() {
    if (!normalizedSource || state.failed || state.retrying) return;
    if (state.attempt >= 2) {
      setImageState({ ...state, failed: true, retrying: false });
      return;
    }

    setImageState({ ...state, retrying: true });
    window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      setImageState({
        source: normalizedSource,
        attempt: state.attempt + 1,
        failed: false,
        retrying: false
      });
    }, state.attempt === 0 ? 700 : 1_800);
  }

  return {
    attempt: state.attempt,
    onError,
    show: Boolean(url) && !state.failed && !state.retrying,
    url
  };
}

function directImageUrl(value?: string) {
  return value || "";
}
