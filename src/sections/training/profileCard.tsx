import {
  Alert,
  Box,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { analysisDaemonStatusAtom, profileAtom } from "./states";
import { useTrainingOverview } from "./useTrainingOverview";

const ANALYZE_LIMITS = [25, 50, 100, 200, 500];

/** Who you are on chess.com / lichess, and the background analysis settings */
export default function ProfileCard() {
  const [profile, setProfile] = useAtom(profileAtom);
  const status = useAtomValue(analysisDaemonStatusAtom);
  const overview = useTrainingOverview();

  const [chessCom, setChessCom] = useState(profile.chessComUsername ?? "");
  const [lichess, setLichess] = useState(profile.lichessUsername ?? "");
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The profile loads from localStorage after the first render
  useEffect(() => {
    setChessCom(profile.chessComUsername ?? "");
    setLichess(profile.lichessUsername ?? "");
  }, [profile.chessComUsername, profile.lichessUsername]);

  useEffect(() => () => clearTimeout(commitTimer.current), []);

  // Only user edits write the usernames, debounced so each keystroke
  // doesn't trigger a rescan of every saved game
  const editUsername = (
    field: "chessComUsername" | "lichessUsername",
    value: string
  ) => {
    const next = {
      chessComUsername: field === "chessComUsername" ? value : chessCom,
      lichessUsername: field === "lichessUsername" ? value : lichess,
    };
    setChessCom(next.chessComUsername);
    setLichess(next.lichessUsername);

    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      setProfile((prev) => ({
        ...prev,
        chessComUsername: next.chessComUsername.trim() || undefined,
        lichessUsername: next.lichessUsername.trim() || undefined,
      }));
    }, 600);
  };

  const hasUsername = !!(profile.chessComUsername || profile.lichessUsername);

  return (
    <Paper variant="outlined" sx={{ p: 2.5, width: "100%" }}>
      <Typography variant="h6" gutterBottom>
        Your accounts
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Training uses your own games. Tell Chesskit which player is you, and it
        analyzes your saved games in the background.
      </Typography>

      <Stack direction={{ xs: "column", sm: "row" }} gap={2} mb={2}>
        <TextField
          label="Chess.com username"
          size="small"
          value={chessCom}
          onChange={(e) => editUsername("chessComUsername", e.target.value)}
          fullWidth
        />
        <TextField
          label="Lichess username"
          size="small"
          value={lichess}
          onChange={(e) => editUsername("lichessUsername", e.target.value)}
          helperText="Used to recognise your games. Lichess auto-import isn't available yet."
          fullWidth
        />
      </Stack>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        gap={2}
        alignItems={{ sm: "center" }}
      >
        <FormControlLabel
          control={
            <Switch
              checked={profile.autoAnalyze}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  autoAnalyze: e.target.checked,
                }))
              }
            />
          }
          label="Analyze my games in the background"
        />
        <TextField
          select
          size="small"
          label="Games to analyze"
          value={profile.autoAnalyzeLimit}
          onChange={(e) =>
            setProfile((prev) => ({
              ...prev,
              autoAnalyzeLimit: Number(e.target.value),
            }))
          }
          sx={{ minWidth: 200 }}
          disabled={!profile.autoAnalyze}
        >
          {ANALYZE_LIMITS.map((limit) => (
            <MenuItem key={limit} value={limit}>
              {limit} most recent
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {!hasUsername && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Add a username to get started. Games you play against the bot on the
          Play page count as yours already.
        </Alert>
      )}

      {overview && (
        <Box mt={2}>
          <Typography variant="body2" color="text.secondary">
            {overview.myGames} of your games saved ({overview.totalGames} in
            total) · {overview.analyzedGames} analyzed · {overview.digests}{" "}
            ready for training
          </Typography>
          {status.phase === "analyzing" && (
            <Box mt={1}>
              <Typography variant="caption" color="text.secondary">
                Analyzing in the background: {status.pending} left
              </Typography>
              <LinearProgress
                variant="determinate"
                value={status.currentProgress ?? 0}
                sx={{ mt: 0.5 }}
              />
            </Box>
          )}
          {status.phase === "paused" && (
            <Typography variant="caption" color="text.secondary">
              {status.pauseReason}: {status.pending} game
              {status.pending === 1 ? "" : "s"} waiting
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}
