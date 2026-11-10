import {
  Grid2 as Grid,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import {
  DataGrid,
  GridColDef,
  GridLocaleText,
  GRID_DEFAULT_LOCALE_TEXT,
  GridActionsCellItem,
  GridRowId,
} from "@mui/x-data-grid";
import { useCallback, useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { blue, red } from "@mui/material/colors";
import LoadGameButton from "@/sections/loadGame/loadGameButton";
import { useGameDatabase } from "@/hooks/useGameDatabase";
import { useRouter } from "next/router";
import { PageTitle } from "@/components/pageTitle";
import { Game, GameSource } from "@/types/game";
import { analysisPriorityAtom, profileAtom } from "@/sections/training/states";
import { ChessComSyncStatusLine } from "@/sections/training/chessComSyncControls";

const SOURCE_LABELS: Record<GameSource, string> = {
  chesscom: "Chess.com",
  lichess: "Lichess",
  chesskit: "Chesskit",
  pgn: "PGN",
};

const gridLocaleText: GridLocaleText = {
  ...GRID_DEFAULT_LOCALE_TEXT,
  noRowsLabel: "No games found",
};

export default function GameDatabase() {
  const { games, deleteGame } = useGameDatabase(true);
  const router = useRouter();
  const profile = useAtomValue(profileAtom);
  const [priority, setPriority] = useAtom(analysisPriorityAtom);
  const [onlyMine, setOnlyMine] = useState(false);

  const myGamesCount = games.filter((game) => game.myColor).length;
  const rows = onlyMine ? games.filter((game) => game.myColor) : games;

  const handleReanalyzeGameRow = useCallback(
    (id: GridRowId) => () => {
      if (typeof id !== "number") return;
      setPriority((ids) => (ids.includes(id) ? ids : [...ids, id]));
    },
    [setPriority]
  );

  const handleDeleteGameRow = useCallback(
    (id: GridRowId) => async () => {
      if (typeof id !== "number") {
        throw new Error("Unable to remove game");
      }
      await deleteGame(id);
    },
    [deleteGame]
  );

  const handleCopyGameRow = useCallback(
    (id: GridRowId) => async () => {
      if (typeof id !== "number") {
        throw new Error("Unable to copy game");
      }
      const game = games.find((g) => g.id === id);
      if (game) await navigator.clipboard?.writeText?.(game.pgn);
    },
    [games]
  );

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: "origin",
        headerName: "Source",
        width: 110,
        valueGetter: (_, row: Game) =>
          row.origin ? SOURCE_LABELS[row.origin] : undefined,
      },
      {
        field: "event",
        headerName: "Event",
        width: 150,
      },
      {
        field: "site",
        headerName: "Site",
        width: 150,
      },
      {
        field: "date",
        headerName: "Date",
        width: 150,
      },
      {
        field: "round",
        headerName: "Round",
        headerAlign: "center",
        align: "center",
        width: 150,
      },
      {
        field: "whiteLabel",
        headerName: "White",
        width: 200,
        headerAlign: "center",
        align: "center",
        valueGetter: (_, row) =>
          `${row.white.name ?? "Unknown"} (${row.white.rating ?? "?"})`,
      },
      {
        field: "result",
        headerName: "Result",
        headerAlign: "center",
        align: "center",
        width: 100,
      },
      {
        field: "blackLabel",
        headerName: "Black",
        width: 200,
        headerAlign: "center",
        align: "center",
        valueGetter: (_, row) =>
          `${row.black.name ?? "Unknown"} (${row.black.rating ?? "?"})`,
      },
      {
        field: "eval",
        headerName: "Evaluation",
        type: "boolean",
        headerAlign: "center",
        align: "center",
        width: 100,
        valueGetter: (_, row) => !!row.eval,
      },
      {
        field: "openEvaluation",
        type: "actions",
        headerName: "Analyze",
        width: 100,
        cellClassName: "actions",
        getActions: ({ id }) => {
          return [
            <GridActionsCellItem
              icon={
                <Icon icon="streamline:magnifying-glass-solid" width="20px" />
              }
              label="Open Evaluation"
              onClick={() =>
                router.push({ pathname: "/", query: { gameId: id } })
              }
              color="inherit"
              key={`${id}-open-eval-button`}
            />,
          ];
        },
      },
      {
        field: "reanalyze",
        type: "actions",
        headerName: "Re-analyze",
        width: 100,
        cellClassName: "actions",
        getActions: ({ id, row }) => {
          const queued = typeof id === "number" && priority.includes(id);
          const label = queued
            ? "Queued for background analysis"
            : (row as Game).eval
              ? "Re-analyze in the background"
              : "Analyze in the background";
          return [
            <GridActionsCellItem
              icon={
                <Icon
                  icon={queued ? "mdi:timer-sand" : "mdi:refresh"}
                  width="20px"
                />
              }
              label={label}
              title={label}
              disabled={queued}
              onClick={handleReanalyzeGameRow(id)}
              color="inherit"
              key={`${id}-reanalyze-button`}
            />,
          ];
        },
      },
      {
        field: "delete",
        type: "actions",
        headerName: "Delete",
        width: 100,
        cellClassName: "actions",
        getActions: ({ id }) => {
          return [
            <GridActionsCellItem
              icon={
                <Icon icon="mdi:delete-outline" color={red[400]} width="20px" />
              }
              label="Delete"
              onClick={handleDeleteGameRow(id)}
              color="inherit"
              key={`${id}-delete-button`}
            />,
          ];
        },
      },
      {
        field: "copy pgn",
        type: "actions",
        headerName: "Copy pgn",
        width: 100,
        cellClassName: "actions",
        getActions: ({ id }) => {
          return [
            <GridActionsCellItem
              icon={
                <Icon icon="ri:clipboard-line" color={blue[400]} width="20px" />
              }
              label="Copy pgn"
              onClick={handleCopyGameRow(id)}
              color="inherit"
              key={`${id}-copy-button`}
            />,
          ];
        },
      },
    ],
    [
      handleDeleteGameRow,
      handleCopyGameRow,
      handleReanalyzeGameRow,
      priority,
      router,
    ]
  );

  return (
    <Grid
      container
      justifyContent="center"
      alignItems="center"
      gap={4}
      marginTop={6}
    >
      <PageTitle title="Chesskit Game Database" />

      <Grid container justifyContent="center" alignItems="center" size={12}>
        <Stack alignItems="center" gap={2}>
          <LoadGameButton />
          <ChessComSyncStatusLine />
        </Stack>
      </Grid>

      <Grid container justifyContent="center" alignItems="center" size={12}>
        <Stack alignItems="center" gap={1}>
          <Typography variant="subtitle2">
            You have {games.length} game{games.length !== 1 && "s"} in your
            database
          </Typography>
          {(profile.chessComUsername ||
            profile.lichessUsername ||
            myGamesCount > 0) && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={onlyMine ? "mine" : "all"}
              onChange={(_, value) => value && setOnlyMine(value === "mine")}
            >
              <ToggleButton value="all">All games</ToggleButton>
              <ToggleButton value="mine">
                My games ({myGamesCount})
              </ToggleButton>
            </ToggleButtonGroup>
          )}
        </Stack>
      </Grid>

      <Grid maxWidth="100%" minWidth="50px">
        <DataGrid
          aria-label="Games list"
          rows={rows}
          columns={columns}
          disableColumnMenu
          localeText={gridLocaleText}
          pageSizeOptions={[25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
            sorting: {
              sortModel: [
                {
                  field: "date",
                  sort: "desc",
                },
              ],
            },
          }}
        />
      </Grid>
    </Grid>
  );
}
