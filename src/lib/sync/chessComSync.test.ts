import { describe, expect, it } from "vitest";
import {
  ChessComArchiveGame,
  chessComGameToDbGame,
  isArchiveComplete,
  parseArchiveMonth,
  selectArchivesToFetch,
} from "./chessComSync";
import { Color } from "@/types/enums";

const archive = (month: string) =>
  `https://api.chess.com/pub/player/me/games/${month}`;

const NOW = Date.UTC(2026, 10, 10, 12); // 2026-11-10

describe("parseArchiveMonth", () => {
  it("reads the year and month from the URL", () => {
    expect(parseArchiveMonth(archive("2024/03"))).toEqual({
      year: 2024,
      month: 3,
    });
    expect(parseArchiveMonth("https://example.com/nope")).toBeUndefined();
  });
});

describe("isArchiveComplete", () => {
  it("is complete a day after the month ends", () => {
    expect(isArchiveComplete(archive("2026/10"), NOW)).toBe(true);
    expect(isArchiveComplete(archive("2026/11"), NOW)).toBe(false);
    // 1 hour into November: October could still receive late games
    expect(
      isArchiveComplete(archive("2026/10"), Date.UTC(2026, 10, 1, 1))
    ).toBe(false);
  });
});

describe("selectArchivesToFetch", () => {
  const archives = [
    archive("2025/12"),
    archive("2026/08"),
    archive("2026/10"),
    archive("2026/09"),
    archive("2026/11"),
  ];

  it("keeps the last N months, oldest first", () => {
    expect(selectArchivesToFetch(archives, undefined, 3, NOW)).toEqual([
      archive("2026/09"),
      archive("2026/10"),
      archive("2026/11"),
    ]);
  });

  it("fetches everything when the history is 0 (all)", () => {
    expect(selectArchivesToFetch(archives, undefined, 0, NOW)).toHaveLength(5);
  });

  it("skips months already imported, and handles year boundaries", () => {
    const cursor = { completeArchives: [archive("2026/09")] };
    expect(selectArchivesToFetch(archives, cursor, 12, NOW)).toEqual([
      archive("2025/12"),
      archive("2026/08"),
      archive("2026/10"),
      archive("2026/11"),
    ]);
  });
});

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.09"]
[Round "-"]
[White "MyName"]
[Black "opponent"]
[Result "0-1"]
[ECO "C50"]
[ECOUrl "https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-4.d3"]
[WhiteElo "1500"]
[BlackElo "1510"]
[TimeControl "300+2"]
[Termination "opponent won by resignation"]
[EndDate "2026.11.09"]
[EndTime "20:15:00"]
[Link "https://www.chess.com/game/live/123"]

1. e4 {[%clk 0:05:01.9]} e5 0-1`;

const apiGame = (
  overrides: Partial<ChessComArchiveGame> = {}
): ChessComArchiveGame => ({
  url: "https://www.chess.com/game/live/123",
  pgn: PGN,
  time_control: "300+2",
  time_class: "blitz",
  end_time: 1794255300,
  rated: true,
  rules: "chess",
  white: { username: "MyName", rating: 1500 },
  black: { username: "opponent", rating: 1510 },
  ...overrides,
});

describe("chessComGameToDbGame", () => {
  it("maps an archive game to a saved game", () => {
    const game = chessComGameToDbGame(apiGame(), {
      chessComUsername: "myname",
    });

    expect(game).toMatchObject({
      pgn: PGN,
      origin: "chesscom",
      externalId: "https://www.chess.com/game/live/123",
      endTime: 1794255300 * 1000,
      timeClass: "blitz",
      rated: true,
      openingName: "Italian Game Two Knights Defense",
      eco: "C50",
      result: "0-1",
      white: { name: "MyName", rating: 1500 },
      black: { name: "opponent", rating: 1510 },
      myColor: Color.White,
    });
  });

  it("skips variants and games without a PGN", () => {
    expect(
      chessComGameToDbGame(apiGame({ rules: "chess960" }), {})
    ).toBeUndefined();
    expect(chessComGameToDbGame(apiGame({ pgn: "" }), {})).toBeUndefined();
  });

  it("falls back to the API fields when the PGN lacks headers", () => {
    const game = chessComGameToDbGame(
      apiGame({
        pgn: '[Result "1-0"]\n\n1. e4 1-0',
        eco: "https://www.chess.com/openings/Kings-Pawn-Opening",
      }),
      { chessComUsername: "OPPONENT" }
    );

    expect(game?.externalId).toBe("https://www.chess.com/game/live/123");
    expect(game?.openingName).toBe("Kings Pawn Opening");
    expect(game?.myColor).toBe(Color.Black);
  });
});
