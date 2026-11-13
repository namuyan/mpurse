import { toDecimal, isAmountWithin, isFeeCovered } from './amount';

describe('send amount helpers', () => {
  it('parses numbers and numeric strings', () => {
    expect(toDecimal('10.5').toString()).toBe('10.5');
    expect(toDecimal(' 3 ').toString()).toBe('3');
    expect(toDecimal(0.1).toString()).toBe('0.1');
    expect(toDecimal('')).toBeNull();
    expect(toDecimal('abc')).toBeNull();
    expect(toDecimal(null)).toBeNull();
    expect(toDecimal(undefined)).toBeNull();
    expect(toDecimal(Infinity)).toBeNull();
  });

  it('compares as numbers, not as strings', () => {
    // "9" <= "10.00000000" is false as a string comparison
    expect(isAmountWithin('9', '10.00000000')).toBe(true);
    expect(isAmountWithin(9, '10.00000000')).toBe(true);
    expect(isAmountWithin('10.00000001', '10.00000000')).toBe(false);
    expect(isAmountWithin('10', '10.00000000')).toBe(true);
    expect(isAmountWithin('100', '20')).toBe(false);
  });

  it('keeps 8 decimal places exact', () => {
    expect(isAmountWithin('0.3', '0.30000000')).toBe(true);
    expect(isAmountWithin(0.1 + 0.2, '0.3')).toBe(false); // 0.30000000000000004
    expect(isAmountWithin('0.00000001', '0.00000001')).toBe(true);
  });

  it('is false for values that are not numbers', () => {
    expect(isAmountWithin('', '10')).toBe(false);
    expect(isAmountWithin('1', '')).toBe(false);
    expect(isAmountWithin('x', '10')).toBe(false);
  });

  it('checks the fee together with the MONA sent', () => {
    // balance 1 MONA, fee 22,600 sat
    expect(isFeeCovered(22600, '1.00000000', '0.99977400')).toBe(true);
    expect(isFeeCovered(22600, '1.00000000', '0.99977401')).toBe(false);
    // sending a token: only the fee is paid in MONA
    expect(isFeeCovered(22600, '0.00022600', 0)).toBe(true);
    expect(isFeeCovered(22600, '0.00022599', 0)).toBe(false);
    expect(isFeeCovered(22600, '1', 'x')).toBe(false);
  });
});
