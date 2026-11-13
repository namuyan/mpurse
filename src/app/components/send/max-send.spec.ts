import { findMaxSendAmount } from './max-send';

/**
 * Fake transaction builder that behaves like counterparty-server: it adds
 * coins until `amount + fee` is covered, the fee grows with the number of
 * inputs, and a remainder below the dust limit is paid as extra fee instead
 * of becoming a change output.
 */
function fakeServer(
  utxos: number[],
  feeRate: number
): { attempt: (amount: number) => Promise<number>; calls: () => number } {
  const dust = 5460;
  let calls = 0;
  return {
    calls: () => calls,
    attempt: (amount: number): Promise<number> => {
      calls++;
      let selected = 0;
      for (let inputs = 1; inputs <= utxos.length; inputs++) {
        selected += utxos[inputs - 1];
        const feeWithChange = feeRate * (10 + 148 * inputs + 34 + 34);
        if (selected >= amount + feeWithChange) {
          const change = selected - amount - feeWithChange;
          // below dust: no change output, the remainder is paid as fee
          return Promise.resolve(
            change > dust ? feeWithChange : selected - amount
          );
        }
      }
      return Promise.reject(new Error('Insufficient MONA'));
    }
  };
}

describe('findMaxSendAmount', () => {
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

  // The largest amount must be buildable and leave (almost) nothing behind.
  async function expectSpendsEverything(
    utxos: number[],
    feeRate: number
  ): Promise<void> {
    const balance = sum(utxos);
    const server = fakeServer(utxos, feeRate);

    const max = await findMaxSendAmount(balance, feeRate, server.attempt);
    const fee = await server.attempt(max);
    const left = balance - max - fee;

    expect(max).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(-1);
    // what remains must be dust-sized, not a spendable amount
    expect(left).toBeLessThan(5460 + feeRate * 200);
  }

  it('sends all of a single coin, fee included', async () => {
    await expectSpendsEverything([98568725], 101);
  });

  it('works with the fast fee rate', async () => {
    await expectSpendsEverything([98568725], 201);
  });

  it('works when several coins are needed', async () => {
    await expectSpendsEverything([50000000, 48568725], 101);
    await expectSpendsEverything(
      [20000000, 20000000, 20000000, 20000000, 18568725],
      201
    );
  });

  it('works with many small coins', async () => {
    await expectSpendsEverything(new Array(20).fill(5000000), 101);
  });

  it('never returns more than the balance minus the fee', async () => {
    const balance = 98568725;
    const server = fakeServer([balance], 101);
    const max = await findMaxSendAmount(balance, 101, server.attempt);
    expect(max + (await server.attempt(max))).toBeLessThan(balance + 1);
  });

  it('finishes within a handful of trial transactions', async () => {
    const server = fakeServer([98568725], 101);
    await findMaxSendAmount(98568725, 101, server.attempt);
    expect(server.calls()).toBeLessThan(13);
  });

  it('rejects when no transaction can be built', async () => {
    let error: any;
    try {
      await findMaxSendAmount(1000, 101, () =>
        Promise.reject(new Error('Insufficient MONA'))
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });
});
