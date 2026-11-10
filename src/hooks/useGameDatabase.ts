import { formatGameToDatabase } from "@/lib/chess";
import {
  ChesskitDBInstance,
  getDb,
  notifyDbChange,
  subscribeDbChange,
} from "@/lib/db";
import { getMyColor } from "@/lib/gameMeta";
import { profileAtom } from "@/sections/training/states";
import { GameEval } from "@/types/eval";
import { Game } from "@/types/game";
import { Chess } from "chess.js";
import { atom, useAtom, useAtomValue } from "jotai";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

const gamesAtom = atom<Game[]>([]);
const fetchGamesAtom = atom<boolean>(false);

export const useGameDatabase = (shouldFetchGames?: boolean) => {
  const [db, setDb] = useState<ChesskitDBInstance | null>(null);
  const profile = useAtomValue(profileAtom);
  const [games, setGames] = useAtom(gamesAtom);
  const [fetchGames, setFetchGames] = useAtom(fetchGamesAtom);
  const [gameFromUrl, setGameFromUrl] = useState<Game | undefined>(undefined);

  useEffect(() => {
    if (shouldFetchGames !== undefined) {
      setFetchGames(shouldFetchGames);
    }
  }, [shouldFetchGames, setFetchGames]);

  useEffect(() => {
    getDb().then(setDb);
  }, []);

  const loadGames = useCallback(async () => {
    if (db && fetchGames) {
      const games = await db.getAll("games");
      setGames(games);
    }
  }, [db, fetchGames, setGames]);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  useEffect(
    () =>
      subscribeDbChange((store) => {
        if (store === "games") loadGames();
      }),
    [loadGames]
  );

  const addGame = useCallback(
    async (game: Chess) => {
      if (!db) throw new Error("Database not initialized");

      const gameToAdd = formatGameToDatabase(game);
      const myColor = getMyColor(gameToAdd, profile);
      const gameId = await db.add("games", { ...gameToAdd, myColor } as Game);

      notifyDbChange("games");

      return gameId;
    },
    [db, profile]
  );

  const setGameEval = useCallback(
    async (gameId: number, evaluation: GameEval) => {
      if (!db) throw new Error("Database not initialized");

      const game = await db.get("games", gameId);
      if (!game) throw new Error("Game not found");

      await db.put("games", { ...game, eval: evaluation });

      notifyDbChange("games");
    },
    [db]
  );

  const getGame = useCallback(
    async (gameId: number) => {
      if (!db) return undefined;

      return db.get("games", gameId);
    },
    [db]
  );

  const deleteGame = useCallback(
    async (gameId: number) => {
      if (!db) throw new Error("Database not initialized");

      const tx = db.transaction(["games", "digests", "puzzles"], "readwrite");
      await tx.objectStore("games").delete(gameId);
      await tx.objectStore("digests").delete(gameId);
      const puzzleIds = await tx
        .objectStore("puzzles")
        .index("by-gameId")
        .getAllKeys(gameId);
      for (const puzzleId of puzzleIds) {
        await tx.objectStore("puzzles").delete(puzzleId);
      }
      await tx.done;

      notifyDbChange("games");
      notifyDbChange("puzzles");
    },
    [db]
  );

  const router = useRouter();
  const { gameId } = router.query;

  useEffect(() => {
    switch (typeof gameId) {
      case "string":
        getGame(parseInt(gameId)).then((game) => {
          setGameFromUrl(game);
        });
        break;
      default:
        setGameFromUrl(undefined);
    }
  }, [gameId, setGameFromUrl, getGame]);

  const isReady = db !== null;

  return {
    addGame,
    setGameEval,
    getGame,
    deleteGame,
    games,
    isReady,
    gameFromUrl,
  };
};
