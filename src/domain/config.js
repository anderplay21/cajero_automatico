export const ATM_ID = 'TECBANK201D';

export const LIMITS = {
  debitWithdrawalDaily: 2_000_000,
  cashDepositDaily: 5_000_000,
  creditAdvanceDaily: 1_000_000,
  creditAdvanceMin: 20_000,
  creditCommissionFixed: 8_000,
  creditCommissionRate: 0.04,
  creditMonthlyRate: 0.023,
  maxPinAttempts: 3,
  qrTtlMs: 45_000,
  sessionTimeoutMs: 120_000,
  minWithdrawal: 10_000,
};

export const LIMIT_COPY = {
  debitWithdrawalDaily: 2_000_000,
  cashDepositDaily: 5_000_000,
  creditAdvanceDaily: 1_000_000,
  creditAdvanceMin: 20_000,
  creditCommissionFixed: 8_000,
};
