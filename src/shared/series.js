/**
 * Best-of-3 series tracking (round 7 #1). Engine-agnostic + testable.
 *
 * A match is a series of rounds; first to `roundsToWin` (default 2, max 3
 * rounds) wins the match. The arena orchestrates round-end → reset → next
 * round; this just owns the score + win logic.
 */
export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 3;

export class SeriesState {
  /**
   * @param {string} playerAId  left/local fighter
   * @param {string} playerBId  right/opponent fighter
   * @param {number} [roundsToWin]
   */
  constructor(playerAId, playerBId, roundsToWin = ROUNDS_TO_WIN) {
    this.playerAId = playerAId;
    this.playerBId = playerBId;
    this.roundsToWin = roundsToWin;
    this.winsA = 0;
    this.winsB = 0;
    this.round = 1;           // current round number (1-based)
  }

  /** Record a round win for a player id. Returns the updated state. */
  recordRoundWin(winnerPlayerId) {
    if (this.isOver) return this;
    if (winnerPlayerId === this.playerAId) this.winsA += 1;
    else if (winnerPlayerId === this.playerBId) this.winsB += 1;
    return this;
  }

  /** True once someone has reached roundsToWin. */
  get isOver() { return this.winsA >= this.roundsToWin || this.winsB >= this.roundsToWin; }

  /** The series winner's player id, or null if still in progress. */
  get seriesWinner() {
    if (this.winsA >= this.roundsToWin) return this.playerAId;
    if (this.winsB >= this.roundsToWin) return this.playerBId;
    return null;
  }

  /** Advance to the next round (call after a non-final round's reset). */
  nextRound() { if (!this.isOver) this.round += 1; return this.round; }

  /** Score as seen from the A (left) side, e.g. "1 - 0". */
  scoreString() { return `${this.winsA} - ${this.winsB}`; }

  /** Serializable snapshot for replication. */
  snapshot() {
    return {
      winsA: this.winsA, winsB: this.winsB, round: this.round,
      roundsToWin: this.roundsToWin, over: this.isOver, winner: this.seriesWinner,
    };
  }
}
