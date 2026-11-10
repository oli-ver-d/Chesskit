import { useCallback, useEffect, useState } from "react";
import { getDb, subscribeDbChange } from "@/lib/db";
import { computeInsights, Insights } from "@/lib/training/insights";

/**
 * The weakness report over all your digests, puzzles and puzzle attempts.
 * Recomputed in memory when digests or puzzles change (attempts notify
 * "puzzles"); cheap for hundreds of games.
 */
export const useInsights = (): Insights | undefined => {
  const [insights, setInsights] = useState<Insights>();

  const load = useCallback(async () => {
    const db = await getDb();
    const [digests, puzzles, puzzleLog, checkLog] = await Promise.all([
      db.getAll("digests"),
      db.getAll("puzzles"),
      db.getAllFromIndex("trainingLog", "by-kind", "puzzle"),
      db.getAllFromIndex("trainingLog", "by-kind", "blunder-check"),
    ]);
    setInsights(
      computeInsights({ digests, puzzles, log: [...puzzleLog, ...checkLog] })
    );
  }, []);

  useEffect(() => {
    load();
    return subscribeDbChange((store) => {
      if (store === "digests" || store === "puzzles") load();
    });
  }, [load]);

  return insights;
};
