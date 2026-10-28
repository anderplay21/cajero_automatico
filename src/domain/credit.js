import { LIMITS } from './config.js';

export function calculateCashAdvance(amount) {
  const principal = Number(amount) || 0;
  const fixedFee = LIMITS.creditCommissionFixed;
  const variableFee = Math.round(principal * LIMITS.creditCommissionRate);
  const commission = fixedFee + variableFee;
  const monthlyInterest = Math.round(principal * LIMITS.creditMonthlyRate);

  return {
    amount: principal,
    fixedFee,
    variableFee,
    commission,
    monthlyInterest,
    totalCharge: principal + commission,
  };
}
