export const DENOMINATIONS = [100000, 50000, 20000, 10000];

export const DENOMINATION_LABELS = {
  100000: '$100.000',
  50000: '$50.000',
  20000: '$20.000',
  10000: '$10.000',
};

export const TRANSACTION_LABELS = {
  retiro: 'Retiro de efectivo',
  deposito: 'Depósito en efectivo',
  consulta: 'Consulta de saldo',
  avance: 'Avance de efectivo',
};

export function formatCOP(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function isMultipleOfDenomination(amount, denomination = 10000) {
  return Number.isInteger(amount) && amount > 0 && amount % denomination === 0;
}

export function sumDenominations(counts) {
  return Object.entries(counts ?? {}).reduce(
    (total, [denomination, count]) => total + Number(denomination) * Number(count || 0),
    0,
  );
}

export function formatBills(counts) {
  return Object.entries(counts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([denomination, count]) => `${Number(count)} x ${DENOMINATION_LABELS[denomination] ?? denomination}`)
    .join(' + ');
}
