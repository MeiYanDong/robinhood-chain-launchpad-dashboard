import { TokenRadarDatabase } from "../token-radar/database.js";
import type { LongLeaderboardResponse } from "./types.js";

export class LongTokenDatabase extends TokenRadarDatabase<LongLeaderboardResponse> {
  constructor(databasePath: string) {
    super(databasePath, "long");
  }
}
