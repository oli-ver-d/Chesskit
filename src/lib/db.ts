import { DBSchema, IDBPDatabase, openDB } from "idb";
import { Game } from "@/types/game";
import {
  GameDigest,
  Puzzle,
  RepertoireNode,
  TrainingLogEntry,
} from "@/types/training";

export const DB_NAME = "games";
export const DB_VERSION = 2;

export interface ChesskitDB extends DBSchema {
  games: {
    key: number;
    value: Game;
    indexes: { "by-externalId": string; "by-endTime": number };
  };
  digests: {
    key: number;
    value: GameDigest;
  };
  puzzles: {
    key: string;
    value: Puzzle;
    indexes: { "by-dueAt": number; "by-gameId": number };
  };
  repertoire: {
    key: string;
    value: RepertoireNode;
    indexes: { "by-dueAt": number };
  };
  trainingLog: {
    key: number;
    value: TrainingLogEntry;
    indexes: { "by-kind": string; "by-at": number };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

export type ChesskitDBInstance = IDBPDatabase<ChesskitDB>;
export type DbStoreName = "games" | "digests" | "puzzles" | "repertoire";

let dbPromise: Promise<ChesskitDBInstance> | null = null;

/**
 * Shared, lazily-opened connection to the app's IndexedDB.
 * Browser only: call it from effects or event handlers.
 */
export const getDb = (): Promise<ChesskitDBInstance> => {
  if (dbPromise) return dbPromise;

  dbPromise = openDB<ChesskitDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore("games", { keyPath: "id", autoIncrement: true });
      }

      if (oldVersion < 2) {
        const games = tx.objectStore("games");
        // Games without an externalId are simply not indexed.
        games.createIndex("by-externalId", "externalId", { unique: true });
        games.createIndex("by-endTime", "endTime");

        db.createObjectStore("digests", { keyPath: "gameId" });

        const puzzles = db.createObjectStore("puzzles", { keyPath: "id" });
        puzzles.createIndex("by-dueAt", "dueAt");
        puzzles.createIndex("by-gameId", "gameId");

        const repertoire = db.createObjectStore("repertoire", {
          keyPath: "id",
        });
        repertoire.createIndex("by-dueAt", "dueAt");

        const log = db.createObjectStore("trainingLog", {
          keyPath: "id",
          autoIncrement: true,
        });
        log.createIndex("by-kind", "kind");
        log.createIndex("by-at", "at");

        db.createObjectStore("meta");
      }
    },
    blocking() {
      // A newer version was opened in another tab: let it upgrade.
      dbPromise?.then((db) => db.close());
      dbPromise = null;
    },
  });

  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
};

export const getMeta = async <T>(key: string): Promise<T | undefined> => {
  const db = await getDb();
  return (await db.get("meta", key)) as T | undefined;
};

export const setMeta = async (key: string, value: unknown): Promise<void> => {
  const db = await getDb();
  await db.put("meta", value, key);
};

const dbEvents = typeof window !== "undefined" ? new EventTarget() : undefined;

/** Tell open views (game list, training pages) that a store changed */
export const notifyDbChange = (store: DbStoreName) => {
  dbEvents?.dispatchEvent(new CustomEvent("change", { detail: store }));
};

export const subscribeDbChange = (
  callback: (store: DbStoreName) => void
): (() => void) => {
  const listener = (event: Event) =>
    callback((event as CustomEvent<DbStoreName>).detail);
  dbEvents?.addEventListener("change", listener);
  return () => dbEvents?.removeEventListener("change", listener);
};
