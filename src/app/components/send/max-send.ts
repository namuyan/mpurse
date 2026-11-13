/**
 * Finds the largest MONA amount that can be sent while still paying the fee
 * from the same balance.
 *
 * The fee depends on the transaction size (number of inputs), which only the
 * server knows once it has built the transaction. So the amount is searched
 * with trial transactions:
 *
 *  1. start slightly below the balance (room for the fee of a small tx),
 *  2. if the server cannot build it, step down by about one more input (the
 *     step doubles on every failure, for wallets with many small coins),
 *  3. once it builds, use the fee it reports to try `balance - fee`, until
 *     the amount stops growing.
 *
 * All values are in satoshi. `attempt` builds a trial transaction for an
 * amount and resolves to its fee, or rejects when it cannot be built.
 */
const TYPICAL_SMALL_TX_BYTES = 250;
const ONE_MORE_INPUT_BYTES = 150;
const MAX_ATTEMPTS = 12;

export async function findMaxSendAmount(
  balanceSat: number,
  feeRateSatPerByte: number,
  attempt: (amountSat: number) => Promise<number>
): Promise<number> {
  let amount = balanceSat - Math.ceil(feeRateSatPerByte * TYPICAL_SMALL_TX_BYTES);
  let step = Math.ceil(feeRateSatPerByte * ONE_MORE_INPUT_BYTES);
  let best = 0;

  for (let tries = 0; tries < MAX_ATTEMPTS && amount > 0; tries++) {
    let fee: number;
    try {
      fee = await attempt(amount);
    } catch (e) {
      if (best > 0) {
        break; // an attempt to enlarge the amount failed: keep the best one
      }
      amount -= step;
      step *= 2;
      continue;
    }
    if (amount + fee > balanceSat) {
      amount = balanceSat - fee;
      continue;
    }
    best = Math.max(best, amount);
    const next = balanceSat - fee;
    if (next <= amount) {
      break;
    }
    amount = next;
  }

  if (best <= 0) {
    throw new Error('Could not build a transaction that spends the full balance');
  }
  return best;
}
