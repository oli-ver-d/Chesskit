import { describe, expect, it } from "vitest";
import {
  getChessComOpeningName,
  getGameMetaFromHeaders,
  parsePgnHeaders,
  getMyColor,
  getTimeClass,
} from "./gameMeta";
import { Color } from "@/types/enums";

describe("getGameMetaFromHeaders", () => {
  it("reads chess.com headers", () => {
    const meta = getGameMetaFromHeaders({
      Site: "Chess.com",
      Link: "https://www.chess.com/game/live/123456",
      TimeControl: "180+2",
      ECO: "B20",
      ECOUrl:
        "https://www.chess.com/openings/Sicilian-Defense-Bowdler-Attack-2.Bc4",
      EndDate: "2026.11.09",
      EndTime: "18:05:30",
    });

    expect(meta).toEqual({
      origin: "chesscom",
      externalId: "https://www.chess.com/game/live/123456",
      timeClass: "blitz",
      eco: "B20",
      openingName: "Sicilian Defense Bowdler Attack",
      endTime: Date.UTC(2026, 10, 9, 18, 5, 30),
    });
  });

  it("reads lichess headers", () => {
    const meta = getGameMetaFromHeaders({
      Site: "https://lichess.org/AbCdEfGh",
      Opening: "French Defense: Winawer Variation",
      UTCDate: "2026.01.02",
      UTCTime: "03:04:05",
      TimeControl: "600+0",
    });

    expect(meta.origin).toBe("lichess");
    expect(meta.externalId).toBe("https://lichess.org/AbCdEfGh");
    expect(meta.openingName).toBe("French Defense: Winawer Variation");
    expect(meta.timeClass).toBe("rapid");
    expect(meta.endTime).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
  });

  it("falls back to pgn origin and the Date header", () => {
    const meta = getGameMetaFromHeaders({ Site: "?", Date: "2020.05.06" });
    expect(meta.origin).toBe("pgn");
    expect(meta.externalId).toBeUndefined();
    expect(meta.endTime).toBe(Date.UTC(2020, 4, 6));
    expect(getGameMetaFromHeaders({ Site: "Chesskit.org" }).origin).toBe(
      "chesskit"
    );
  });
});

describe("getTimeClass", () => {
  it.each([
    ["60", "bullet"],
    ["120+1", "bullet"],
    ["180", "blitz"],
    ["300+3", "blitz"],
    ["600", "rapid"],
    ["1800", "classical"],
    ["1/86400", "daily"],
    ["-", undefined],
    [undefined, undefined],
  ])("%s → %s", (timeControl, expected) => {
    expect(getTimeClass(timeControl)).toBe(expected);
  });
});

describe("getChessComOpeningName", () => {
  it("strips the move suffix", () => {
    expect(
      getChessComOpeningName(
        "https://www.chess.com/openings/Queens-Gambit-Declined-3...Nf6"
      )
    ).toBe("Queens Gambit Declined");
    expect(getChessComOpeningName(undefined)).toBeUndefined();
  });
});

describe("getMyColor", () => {
  const game = {
    white: { name: "MagnusFan" },
    black: { name: "someone" },
    site: "Chess.com",
  };

  it("matches usernames case-insensitively", () => {
    expect(getMyColor(game, { chessComUsername: " magnusfan " })).toBe(
      Color.White
    );
    expect(getMyColor(game, { lichessUsername: "SOMEONE" })).toBe(Color.Black);
    expect(getMyColor(game, { chessComUsername: "nobody" })).toBeUndefined();
    expect(getMyColor(game, {})).toBeUndefined();
  });

  it("recognises Play-page games against the bot", () => {
    expect(
      getMyColor(
        {
          white: { name: "Stockfish (1500)" },
          black: { name: "You" },
          site: "Chesskit.org",
        },
        {}
      )
    ).toBe(Color.Black);
  });
});

describe("parsePgnHeaders", () => {
  it("reads tag pairs and ignores moves", () => {
    expect(
      parsePgnHeaders(
        '[Event "Live \\"Chess\\""]\n[Site "Chess.com"]\n\n1. e4 {[%clk 0:03:00]} e5 *'
      )
    ).toEqual({ Event: 'Live "Chess"', Site: "Chess.com" });
  });
});
