import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { callOpenRouter, ChatMessage } from "@/lib/coach/openrouter";
import {
  coachApiKeyAtom,
  coachModelAtom,
  coachSettingsOpenAtom,
  coachTextCacheAtom,
  CoachText,
} from "./states";

const inFlight = new Set<string>();

export const useCoachLLM = () => {
  const apiKey = useAtomValue(coachApiKeyAtom);
  const model = useAtomValue(coachModelAtom);
  const setSettingsOpen = useSetAtom(coachSettingsOpenAtom);
  const [cache, setCache] = useAtom(coachTextCacheAtom);

  const ask = useCallback(
    async (
      key: string,
      messages: ChatMessage[],
      options?: { maxTokens?: number; force?: boolean }
    ): Promise<string | undefined> => {
      const cacheKey = `${model}|${key}`;
      if (inFlight.has(cacheKey)) return undefined;
      if (!options?.force && cache[cacheKey]?.status === "done") {
        return cache[cacheKey].text;
      }

      inFlight.add(cacheKey);
      setCache((prev) => ({ ...prev, [cacheKey]: { status: "loading" } }));

      try {
        const text = await callOpenRouter({
          apiKey,
          model,
          messages,
          maxTokens: options?.maxTokens,
        });
        setCache((prev) => ({ ...prev, [cacheKey]: { status: "done", text } }));
        return text;
      } catch (e) {
        setCache((prev) => ({
          ...prev,
          [cacheKey]: {
            status: "error",
            text: (e as Error)?.message ?? "Something went wrong.",
          },
        }));
        return undefined;
      } finally {
        inFlight.delete(cacheKey);
      }
    },
    [apiKey, model, cache, setCache]
  );

  const get = useCallback(
    (key: string): CoachText | undefined => cache[`${model}|${key}`],
    [cache, model]
  );

  return {
    ask,
    get,
    hasKey: !!apiKey,
    model,
    openSettings: () => setSettingsOpen(true),
  };
};
