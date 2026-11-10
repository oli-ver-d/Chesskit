import { Box, CircularProgress, IconButton, Tooltip } from "@mui/material";
import { Icon } from "@iconify/react";
import { useAtom, useAtomValue } from "jotai";
import { analysisDaemonStatusAtom, analysisPausedAtom } from "./states";

/** NavBar status of the background analysis, with a pause / resume toggle */
export default function AnalysisIndicator() {
  const status = useAtomValue(analysisDaemonStatusAtom);
  const [userPaused, setUserPaused] = useAtom(analysisPausedAtom);

  if (status.phase !== "analyzing" && status.phase !== "paused") return null;

  const gamesLeft = `${status.pending} game${status.pending === 1 ? "" : "s"} left`;
  const title =
    status.phase === "analyzing"
      ? `Analyzing your games in the background: ${gamesLeft}. Click to pause.`
      : `${status.pauseReason ?? "Paused"}: ${gamesLeft}.${
          userPaused ? " Click to resume." : ""
        }`;

  return (
    <Tooltip title={title}>
      <IconButton
        color="inherit"
        aria-label={title}
        onClick={() => setUserPaused((paused) => !paused)}
        sx={{ mr: "min(0.6rem, 0.8vw)" }}
      >
        <Box
          sx={{
            position: "relative",
            display: "inline-flex",
            width: 24,
            height: 24,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {status.phase === "analyzing" && (
            <CircularProgress
              size={24}
              thickness={4}
              variant={status.currentProgress ? "determinate" : "indeterminate"}
              value={status.currentProgress}
              sx={{ position: "absolute" }}
            />
          )}
          <Icon
            icon={status.phase === "analyzing" ? "mdi:pause" : "mdi:play-pause"}
            width={status.phase === "analyzing" ? 14 : 22}
          />
        </Box>
      </IconButton>
    </Tooltip>
  );
}
