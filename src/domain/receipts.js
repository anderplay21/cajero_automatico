import { ATM_ID } from './config.js';
import { TRANSACTION_LABELS } from './money.js';

export function buildReceipt(transaction, options = {}) {
  const atmId = options.atmId ?? ATM_ID;
  const printedAt = options.printedAt ?? new Date().toISOString();

  return {
    atmId,
    receiptNumber: `RCP-${transaction.id}`,
    printedAt,
    operationId: transaction.id,
    transactionAt: transaction.at,
    type: transaction.type,
    typeLabel: TRANSACTION_LABELS[transaction.type] ?? transaction.type,
    status: transaction.status,
    channel: transaction.channel,
    customerName: transaction.customerName,
    accountMasked: transaction.accountMasked,
    cardMasked: transaction.cardMasked,
    amount: transaction.amount,
    fixedFee: transaction.fixedFee ?? 0,
    variableFee: transaction.variableFee ?? 0,
    commission: transaction.commission ?? 0,
    monthlyInterest: transaction.monthlyInterest ?? 0,
    totalCharge: transaction.totalCharge ?? transaction.amount,
    balanceAfter: transaction.balanceAfter ?? null,
    availableCreditAfter: transaction.availableCreditAfter ?? null,
    dispensed: transaction.dispensed ?? null,
    deposited: transaction.deposited ?? null,
    reason: transaction.reason ?? null,
    interestStartAt: transaction.interestStartAt ?? null,
  };
}
