/**
 * Bookmaker's Den betting (GDD §4B). Engine-agnostic + testable.
 *
 * Each spectator places EXACTLY ONE wager per bout before the training timer
 * expires. Three bet types, all 2.0x payout on success:
 *   - PLAYER_WINS      : a specific fighter wins the bout
 *   - BOUT_UNDER_60    : the bout ends in under 60 seconds
 *   - MONSTER_STUNNED_3: a specific monster is stunned at least 3 times
 *
 * Max wager defaults to maxBetAmount (debug §9). Successful bets double the
 * wagered amount (net +stake); failed bets lose the stake.
 */
import { DebugConfig } from './debugConfig.js';

export const BET_TYPES = {
  PLAYER_WINS: 'PLAYER_WINS',
  BOUT_UNDER_60: 'BOUT_UNDER_60',
  MONSTER_STUNNED_3: 'MONSTER_STUNNED_3',
};

export const PAYOUT_MULTIPLIER = 2.0;
export const BOUT_UNDER_SECONDS = 60;
export const STUN_THRESHOLD = 3;

/**
 * @typedef {Object} Bet
 * @property {string} type       one of BET_TYPES
 * @property {number} stake      gold wagered (1..maxBet)
 * @property {string} [targetPlayerId]   for PLAYER_WINS
 * @property {string} [targetMonsterId]  for MONSTER_STUNNED_3
 */

export class BettingBook {
  constructor() {
    /** @type {Map<string, Bet>} spectatorId -> their single bet */
    this.bets = new Map();
    this.open = true; // closes when the training timer expires
  }

  closeBetting() { this.open = false; }

  /** Maximum allowed stake (debug §9, live). */
  get maxBet() { return DebugConfig.get('maxBetAmount'); }

  /**
   * Place a spectator's single wager. Rejects if betting closed, already bet,
   * invalid stake, or missing required target.
   * @param {string} spectatorId
   * @param {Bet} bet
   * @param {number} spectatorGold  for stake validation
   * @returns {{ok:boolean, reason?:string}}
   */
  placeBet(spectatorId, bet, spectatorGold) {
    if (!this.open) return { ok: false, reason: 'betting_closed' };
    if (this.bets.has(spectatorId)) return { ok: false, reason: 'already_bet' };
    if (!Object.values(BET_TYPES).includes(bet.type)) return { ok: false, reason: 'bad_type' };

    const stake = Math.round(Number(bet.stake));
    if (!Number.isFinite(stake) || stake <= 0) return { ok: false, reason: 'bad_stake' };
    if (stake > this.maxBet) return { ok: false, reason: 'over_max' };
    if (stake > spectatorGold) return { ok: false, reason: 'insufficient_gold' };

    if (bet.type === BET_TYPES.PLAYER_WINS && !bet.targetPlayerId) return { ok: false, reason: 'need_target_player' };
    if (bet.type === BET_TYPES.MONSTER_STUNNED_3 && !bet.targetMonsterId) return { ok: false, reason: 'need_target_monster' };

    this.bets.set(spectatorId, { type: bet.type, stake, targetPlayerId: bet.targetPlayerId, targetMonsterId: bet.targetMonsterId });
    return { ok: true };
  }

  getBet(spectatorId) { return this.bets.get(spectatorId); }

  /**
   * Resolve all bets against the bout outcome.
   * @param {Object} outcome
   * @param {string} outcome.winnerPlayerId
   * @param {number} outcome.boutDurationSec
   * @param {Record<string, number>} outcome.stunCountsByMonsterId
   * @returns {Map<string, {won:boolean, stake:number, payout:number, net:number}>}
   */
  resolve(outcome) {
    const results = new Map();
    for (const [spectatorId, bet] of this.bets) {
      const won = this._betWins(bet, outcome);
      const payout = won ? bet.stake * PAYOUT_MULTIPLIER : 0;
      results.set(spectatorId, {
        won,
        stake: bet.stake,
        payout,                      // total returned (stake*2 on win)
        net: won ? bet.stake : -bet.stake,
      });
    }
    return results;
  }

  _betWins(bet, o) {
    switch (bet.type) {
      case BET_TYPES.PLAYER_WINS:
        return o.winnerPlayerId === bet.targetPlayerId;
      case BET_TYPES.BOUT_UNDER_60:
        return o.boutDurationSec < BOUT_UNDER_SECONDS;
      case BET_TYPES.MONSTER_STUNNED_3:
        return (o.stunCountsByMonsterId?.[bet.targetMonsterId] ?? 0) >= STUN_THRESHOLD;
      default:
        return false;
    }
  }
}
