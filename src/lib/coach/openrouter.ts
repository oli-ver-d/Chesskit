export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  promptPrice?: number; // USD per 1M tokens
  completionPrice?: number; // USD per 1M tokens
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const getAppHeaders = () => {
  const headers: Record<string, string> = {
    "X-Title": "Chesskit AI Coach",
  };
  if (typeof window !== "undefined") {
    headers["HTTP-Referer"] = window.location.origin;
  }
  return headers;
};

export const callOpenRouter = async ({
  apiKey,
  model,
  messages,
  maxTokens = 800,
  temperature = 0.5,
  signal,
}: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<string> => {
  if (!apiKey) {
    throw new OpenRouterError(
      "Add your OpenRouter API key in the AI Coach settings first."
    );
  }

  let res: Response;
  try {
    res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...getAppHeaders(),
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new OpenRouterError(
      "Could not reach OpenRouter. Check your connection."
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = undefined;
  try {
    data = await res.json();
  } catch {
    // ignore, handled below
  }

  if (!res.ok || data?.error) {
    const message: string =
      data?.error?.message ?? `OpenRouter request failed (${res.status})`;
    if (res.status === 401) {
      throw new OpenRouterError("Your OpenRouter API key was rejected.", 401);
    }
    if (res.status === 402) {
      throw new OpenRouterError(
        "Your OpenRouter account is out of credits.",
        402
      );
    }
    throw new OpenRouterError(message, res.status);
  }

  const content = data?.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part: { text?: string }) => part?.text ?? "").join("")
        : "";

  if (!text.trim()) {
    throw new OpenRouterError(
      "The model returned an empty answer. Try again or pick another model."
    );
  }

  return text.trim();
};

let modelsCache: Promise<OpenRouterModel[]> | null = null;

export const fetchOpenRouterModels = (): Promise<OpenRouterModel[]> => {
  if (modelsCache) return modelsCache;

  modelsCache = fetch(`${OPENROUTER_BASE_URL}/models`)
    .then((res) => res.json())
    .then((data) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data?.data ?? []) as any[])
        .filter((m) => typeof m?.id === "string")
        .map((m) => ({
          id: m.id as string,
          name: (m.name as string) ?? m.id,
          promptPrice: m.pricing?.prompt
            ? Number(m.pricing.prompt) * 1_000_000
            : undefined,
          completionPrice: m.pricing?.completion
            ? Number(m.pricing.completion) * 1_000_000
            : undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    .catch(() => {
      modelsCache = null;
      return [];
    });

  return modelsCache;
};
