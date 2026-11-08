import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import {
  callOpenRouter,
  fetchOpenRouterModels,
  OpenRouterModel,
} from "@/lib/coach/openrouter";
import {
  coachApiKeyAtom,
  coachModelAtom,
  coachSettingsOpenAtom,
  DEFAULT_COACH_MODEL,
  reviewAutoExplainAtom,
} from "./states";

const SUGGESTED_MODELS = [
  "google/gemini-2.5-flash",
  "openai/gpt-4.1-mini",
  "anthropic/claude-haiku-4.5",
  "deepseek/deepseek-chat-v3.1",
  "openai/gpt-5-mini",
  "anthropic/claude-sonnet-4.5",
];

const formatPrice = (m?: OpenRouterModel) => {
  if (m?.promptPrice === undefined || m?.completionPrice === undefined)
    return "";
  if (m.promptPrice === 0 && m.completionPrice === 0) return "free";
  return `$${m.promptPrice.toFixed(2)} / $${m.completionPrice.toFixed(2)} per 1M tokens`;
};

export default function CoachSettingsDialog() {
  const [open, setOpen] = useAtom(coachSettingsOpenAtom);
  const [apiKey, setApiKey] = useAtom(coachApiKeyAtom);
  const [model, setModel] = useAtom(coachModelAtom);
  const [autoExplain, setAutoExplain] = useAtom(reviewAutoExplainAtom);

  const [keyInput, setKeyInput] = useState(apiKey);
  const [modelInput, setModelInput] = useState(model);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [testState, setTestState] = useState<
    | { status: "idle" }
    | { status: "testing" }
    | { status: "ok" | "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!open) return;
    setKeyInput(apiKey);
    setModelInput(model);
    setTestState({ status: "idle" });
    fetchOpenRouterModels().then(setModels);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelById = useMemo(
    () => Object.fromEntries(models.map((m) => [m.id, m])),
    [models]
  );

  const suggested = useMemo(
    () =>
      models.length
        ? SUGGESTED_MODELS.filter((id) => modelById[id])
        : SUGGESTED_MODELS.slice(0, 4),
    [models, modelById]
  );

  const handleSave = () => {
    setApiKey(keyInput.trim());
    setModel(modelInput.trim() || DEFAULT_COACH_MODEL);
    setOpen(false);
  };

  const handleTest = async () => {
    setTestState({ status: "testing" });
    try {
      const reply = await callOpenRouter({
        apiKey: keyInput.trim(),
        model: modelInput.trim() || DEFAULT_COACH_MODEL,
        messages: [
          {
            role: "user",
            content:
              "In under 12 words, greet a chess player as their new coach.",
          },
        ],
        maxTokens: 300,
      });
      setTestState({ status: "ok", message: reply });
    } catch (e) {
      setTestState({
        status: "error",
        message: (e as Error)?.message ?? "Test failed",
      });
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Icon icon="mdi:robot-happy-outline" height={26} />
        AI Coach settings
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            The coach uses Stockfish to judge every move, then asks an AI model
            on{" "}
            <Link href="https://openrouter.ai" target="_blank" rel="noopener">
              OpenRouter
            </Link>{" "}
            to explain it in plain English. Bring your own key: it is stored
            only in this browser and sent directly to OpenRouter.
          </Typography>

          <TextField
            label="OpenRouter API key"
            placeholder="sk-or-v1-..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            fullWidth
            helperText={
              <>
                Create one at{" "}
                <Link
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noopener"
                >
                  openrouter.ai/settings/keys
                </Link>
                . Setting a credit limit on the key is a good idea.
              </>
            }
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowKey((v) => !v)}
                      edge="end"
                      aria-label="toggle key visibility"
                    >
                      <Icon icon={showKey ? "mdi:eye-off" : "mdi:eye"} />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <Autocomplete
            freeSolo
            options={models.map((m) => m.id)}
            value={modelInput}
            onInputChange={(_, value) => setModelInput(value)}
            filterOptions={(options, state) => {
              const q = state.inputValue.toLowerCase();
              return options
                .filter(
                  (id) =>
                    id.toLowerCase().includes(q) ||
                    modelById[id]?.name.toLowerCase().includes(q)
                )
                .slice(0, 50);
            }}
            renderOption={(props, id) => {
              const { key, ...rest } = props as typeof props & { key: string };
              return (
                <li key={key} {...rest}>
                  <Stack>
                    <Typography variant="body2">
                      {modelById[id]?.name ?? id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {id}{" "}
                      {formatPrice(modelById[id]) &&
                        `· ${formatPrice(modelById[id])}`}
                    </Typography>
                  </Stack>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Model"
                helperText={
                  formatPrice(modelById[modelInput]) ||
                  "Any OpenRouter model id. Fast, cheap models work well."
                }
              />
            )}
          />

          <Stack direction="row" flexWrap="wrap" gap={1}>
            {suggested.map((id) => (
              <Chip
                key={id}
                label={id}
                size="small"
                variant={id === modelInput ? "filled" : "outlined"}
                color={id === modelInput ? "primary" : "default"}
                onClick={() => setModelInput(id)}
              />
            ))}
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={autoExplain}
                onChange={(e) => setAutoExplain(e.target.checked)}
              />
            }
            label="Game review: explain each move automatically"
          />

          {testState.status === "ok" && (
            <Alert severity="success">
              Working! Coach says: “{testState.message}”
            </Alert>
          )}
          {testState.status === "error" && (
            <Alert severity="error">{testState.message}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={handleTest}
          disabled={!keyInput.trim() || testState.status === "testing"}
        >
          {testState.status === "testing" ? "Testing…" : "Test"}
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
