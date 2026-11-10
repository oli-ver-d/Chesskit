import { getDb, notifyDbChange } from "@/lib/db";
import { Color } from "@/types/enums";
import { PuzzleResult, RepertoireNode } from "@/types/training";
import { getRepertoireId } from "./repertoire";
import { schedulePuzzle } from "./schedule";

const newNode = (color: Color, fenKey: string): RepertoireNode => ({
  id: getRepertoireId(color, fenKey),
  color,
  fenKey,
  box: 0,
  dueAt: 0,
  attempts: 0,
});

/** Changes one stored repertoire node (created if missing) */
export const updateRepertoireNode = async (
  color: Color,
  fenKey: string,
  update: (node: RepertoireNode) => RepertoireNode
): Promise<RepertoireNode> => {
  const db = await getDb();
  const tx = db.transaction("repertoire", "readwrite");
  const stored = await tx.store.get(getRepertoireId(color, fenKey));
  const updated = update(stored ?? newNode(color, fenKey));
  await tx.store.put(updated);
  await tx.done;
  notifyDbChange("repertoire");
  return updated;
};

/** Saves a drill answer: reschedules the position and logs it */
export const recordOpeningAttempt = async (
  color: Color,
  fenKey: string,
  result: PuzzleResult,
  details: { playedUci: string; expectedUci: string; alternative?: boolean }
): Promise<void> => {
  const db = await getDb();
  const now = Date.now();
  const id = getRepertoireId(color, fenKey);
  const tx = db.transaction(["repertoire", "trainingLog"], "readwrite");
  const store = tx.objectStore("repertoire");

  const node = (await store.get(id)) ?? newNode(color, fenKey);
  const updated: RepertoireNode = {
    ...node,
    ...schedulePuzzle(node.box, result, now),
    attempts: node.attempts + 1,
    lastAttemptAt: now,
    lastResult: result,
  };
  await store.put(updated);
  await tx.objectStore("trainingLog").add({
    kind: "opening",
    at: now,
    refId: id,
    success: result !== "failed",
    data: { result, ...details, box: updated.box },
  });
  await tx.done;
  notifyDbChange("repertoire");
};
