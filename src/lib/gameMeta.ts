import { Color } from "@/types/enums";
import { Game, GameSource } from "@/types/game";

type Headers = Record<string, string | undefined>;

/** Reads PGN tag pairs without parsing the moves */
export const parsePgnHeaders = (pgn: string): Headers => {
  const headers: Headers = {};
  const tagPair = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  for (const match of pgn.matchAll(tagPair)) {
    headers[match[1]] = match[2].replace(/\\(.)/g, "$1");
  }
  return headers;
};

export interface GameMeta {
  origin: GameSource;
  externalId?: string;
  endTime?: number;
  timeClass?: string;
  openingName?: string;
  eco?: string;
}

/** Metadata the training features need, derived from PGN headers */
export const getGameMetaFromHeaders = (headers: Headers): GameMeta => {
  const site = headers.Site ?? "";
  const link = headers.Link ?? "";

  let origin: GameSource = "pgn";
  let externalId: string | undefined;

  if (/chess\.com/i.test(site) || /chess\.com/i.test(link)) {
    origin = "chesscom";
    externalId = link.startsWith("http") ? link : undefined;
  } else if (/^https?:\/\/lichess\.org\//i.test(site)) {
    origin = "lichess";
    externalId = site;
  } else if (site === "Chesskit.org") {
    origin = "chesskit";
  }

  return {
    origin,
    externalId,
    endTime: getEndTime(headers),
    timeClass: getTimeClass(headers.TimeControl),
    openingName: headers.Opening || getChessComOpeningName(headers.ECOUrl),
    eco: headers.ECO && headers.ECO !== "?" ? headers.ECO : undefined,
  };
};

const parsePgnDateTime = (
  date: string | undefined,
  time: string | undefined
): number | undefined => {
  const dateMatch = date?.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!dateMatch) return undefined;

  const timeMatch = time?.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  const [, y, m, d] = dateMatch.map(Number);
  const [, hh, mm, ss] = timeMatch ? timeMatch.map(Number) : [0, 0, 0, 0];

  const value = Date.UTC(y, m - 1, d, hh, mm, ss);
  return Number.isNaN(value) ? undefined : value;
};

const getEndTime = (headers: Headers): number | undefined =>
  parsePgnDateTime(headers.EndDate, headers.EndTime) ??
  parsePgnDateTime(headers.UTCDate, headers.UTCTime) ??
  parsePgnDateTime(headers.Date, undefined);

/**
 * Same thresholds as lichess: estimated duration = base + 40 × increment.
 * Correspondence time controls ("1/86400") are "daily".
 */
export const getTimeClass = (
  timeControl: string | undefined
): string | undefined => {
  if (!timeControl || timeControl === "-" || timeControl === "?") {
    return undefined;
  }
  if (timeControl.includes("/")) return "daily";

  const [base, increment] = timeControl.split("+").map(Number);
  if (Number.isNaN(base)) return undefined;

  const duration = base + 40 * (Number.isNaN(increment) ? 0 : (increment ?? 0));
  if (duration < 180) return "bullet";
  if (duration < 480) return "blitz";
  if (duration < 1500) return "rapid";
  return "classical";
};

/**
 * "https://www.chess.com/openings/Sicilian-Defense-Old-Sicilian-3.d4"
 * → "Sicilian Defense Old Sicilian"
 */
export const getChessComOpeningName = (
  ecoUrl: string | undefined
): string | undefined => {
  const slug = ecoUrl?.split("/openings/")[1]?.split(/[?#]/)[0];
  if (!slug) return undefined;

  const words: string[] = [];
  for (const token of decodeURIComponent(slug).split("-")) {
    if (/^\d+\.{1,3}/.test(token)) break;
    if (token) words.push(token);
  }

  return words.length ? words.join(" ") : undefined;
};

export interface Identity {
  chessComUsername?: string;
  lichessUsername?: string;
}

const normalize = (name: string | undefined) => name?.trim().toLowerCase();

/** Which colour you played in `game`, based on your profile usernames */
export const getMyColor = (
  game: Pick<Game, "white" | "black" | "site">,
  identity: Identity
): Color | undefined => {
  // Games played against the bot on the Play page name the user "You"
  if (game.site === "Chesskit.org") {
    if (game.white.name === "You") return Color.White;
    if (game.black.name === "You") return Color.Black;
  }

  const names = [identity.chessComUsername, identity.lichessUsername]
    .map(normalize)
    .filter((name): name is string => !!name);
  if (!names.length) return undefined;

  const white = normalize(game.white.name);
  const black = normalize(game.black.name);
  if (white && names.includes(white)) return Color.White;
  if (black && names.includes(black)) return Color.Black;
  return undefined;
};
