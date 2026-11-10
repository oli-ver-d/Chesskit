import { useCallback, useEffect, useState } from "react";
import { getDb, subscribeDbChange } from "@/lib/db";

export interface TrainingOverview {
  totalGames: number;
  myGames: number;
  analyzedGames: number;
  digests: number;
}

/** Counts shown on the Train page, refreshed when games or digests change */
export const useTrainingOverview = (): TrainingOverview | undefined => {
  const [overview, setOverview] = useState<TrainingOverview>();

  const load = useCallback(async () => {
    const db = await getDb();
    const games = await db.getAll("games");
    const myGames = games.filter((game) => game.myColor);

    setOverview({
      totalGames: games.length,
      myGames: myGames.length,
      analyzedGames: myGames.filter((game) => game.eval).length,
      digests: await db.count("digests"),
    });
  }, []);

  useEffect(() => {
    load();
    return subscribeDbChange((store) => {
      if (store === "games" || store === "digests") load();
    });
  }, [load]);

  return overview;
};
