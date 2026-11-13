import { Decimal } from 'decimal.js';

/**
 * Amounts reach the send form as numbers or as strings (query parameters,
 * DApp requests, balances from the API). Comparing them with `<=` compares
 * strings by character ("9" <= "10.0" is false), so parse them first.
 */
export function toDecimal(value: any): Decimal | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (text === '') {
    return null;
  }
  try {
    const d = new Decimal(text);
    return d.isFinite() ? d : null;
  } catch (e) {
    return null;
  }
}

/** amount <= available. False when either value is not a number. */
export function isAmountWithin(amount: any, available: any): boolean {
  const a = toDecimal(amount);
  const b = toDecimal(available);
  return a !== null && b !== null && a.lte(b);
}

/**
 * Whether the MONA balance covers the fee (in satoshi) plus the MONA that is
 * being sent (0 when sending a token).
 */
export function isFeeCovered(
  feeSat: any,
  monaBalance: any,
  monaSent: any
): boolean {
  const fee = toDecimal(feeSat);
  const sent = toDecimal(monaSent);
  if (fee === null || sent === null) {
    return false;
  }
  return isAmountWithin(fee.div(100000000).plus(sent), monaBalance);
}
