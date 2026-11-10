import { useCallback, useEffect, useState } from "react";
import { getDb, subscribeDbChange } from "@/lib/db";
import { buildRepertoire, Repertoire } from "@/lib/training/repertoire";
import { Color } from "@/types/enums";
import { GameDigest } from "@/types/training";

export interface RepertoireData {
  white: Repertoire;
  black: Repertoire;
  digests: GameDigest[];
}

/**
 * Your White and Black repertoires, rebuilt in memory from all digests plus
 * your stored edits whenever either changes (cheap: the first 16 plies of
 * each game).
 */
export const useRepertoire = (): RepertoireData | undefined => {
  const [data, setData] = useState<RepertoireData>();

  const load = useCallback(async () => {
    const db = await getDb();
    const [digests, nodes] = await Promise.all([
      db.getAll("digests"),
      db.getAll("repertoire"),
    ]);
    setData({
      white: buildRepertoire(digests, Color.White, nodes),
      black: buildRepertoire(digests, Color.Black, nodes),
      digests,
    });
  }, []);

  useEffect(() => {
    load();
    return subscribeDbChange((store) => {
      if (store === "digests" || store === "repertoire") load();
    });
  }, [load]);

  return data;
};
