import { useCallback, useEffect, useState } from "react";
import { getDb, subscribeDbChange } from "@/lib/db";
import { Puzzle } from "@/types/training";

/** All stored puzzles, reloaded when the puzzles store changes */
export const usePuzzles = (): Puzzle[] | undefined => {
  const [puzzles, setPuzzles] = useState<Puzzle[]>();

  const load = useCallback(async () => {
    const db = await getDb();
    setPuzzles(await db.getAll("puzzles"));
  }, []);

  useEffect(() => {
    load();
    return subscribeDbChange((store) => {
      if (store === "puzzles") load();
    });
  }, [load]);

  return puzzles;
};
