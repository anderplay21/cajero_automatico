import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtmService } from '../src/domain/atm-service.js';
import { buildReceipt } from '../src/domain/receipts.js';
import { ATM_STATES } from '../src/domain/state-machine.js';

function setup() {
  let current = Date.parse('2026-10-27T10:00:00.000Z');
  const service = createAtmService({ clock: () => current });
  return {
    service,
    advance(ms) {
      current += ms;
    },
  };
}

function authenticateDebit(service) {
  service.startCardSession('card-debit-ana');
  assert.equal(service.submitPin('1234').ok, true);
}

test('genera recibo de retiro con datos de operación y saldo', () => {
  const { service } = setup();
  authenticateDebit(service);
  const withdrawal = service.withdraw(100000);

  const result = service.printReceipt(withdrawal.transaction.id);
  assert.equal(result.ok, true);
  assert.equal(result.receipt.receiptNumber, 'RCP-TX-0001');
  assert.equal(result.receipt.typeLabel, 'Retiro de efectivo');
  assert.equal(result.receipt.amount, 100000);
  assert.equal(result.receipt.balanceAfter, 3_400_000);
  assert.equal(result.receipt.accountMasked, '**** 8834');
  assert.equal(service.state, ATM_STATES.PRINTING);
});

test('genera recibo de avance con comisión e interés', () => {
  const { service } = setup();
  service.startCardSession('card-credit-ana');
  service.submitPin('4321');
  const advance = service.cashAdvance(100000);
  const result = service.printReceipt(advance.transaction.id);

  assert.equal(result.ok, true);
  assert.equal(result.receipt.fixedFee, 8_000);
  assert.equal(result.receipt.variableFee, 4_000);
  assert.equal(result.receipt.commission, 12_000);
  assert.equal(result.receipt.monthlyInterest, 2_300);
  assert.equal(result.receipt.totalCharge, 112_000);
  assert.equal(result.receipt.availableCreditAfter, 1_888_000);
});

test('permite imprimir recibo de una transacción rechazada', () => {
  const { service } = setup();
  authenticateDebit(service);
  assert.equal(service.withdraw(2_000_000).ok, true);
  const rejected = service.withdraw(10_000);
  assert.equal(rejected.ok, false);

  const result = service.printReceipt(rejected.transaction.id);
  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'rechazada');
  assert.match(result.receipt.reason, /límite diario/i);
});

test('construye un recibo a partir de una transacción sin sesión activa', () => {
  const receipt = buildReceipt({
    id: 'TX-9999',
    at: '2026-10-27T10:00:00.000Z',
    type: 'consulta',
    status: 'aprobada',
    channel: 'qr',
    customerName: 'Ana María Gómez',
    accountMasked: '**** 8834',
    cardMasked: '4512 •••• •••• 8834',
    amount: 0,
    balanceAfter: 3_500_000,
  });
  assert.equal(receipt.receiptNumber, 'RCP-TX-9999');
  assert.equal(receipt.typeLabel, 'Consulta de saldo');
  assert.equal(receipt.balanceAfter, 3_500_000);
});

test('registra auditoría completa de autenticación, transacción, recibo y cierre', () => {
  const { service } = setup();
  authenticateDebit(service);
  const withdrawal = service.withdraw(100000);
  service.printReceipt(withdrawal.transaction.id);
  service.endSession('user');

  const events = service.getAudit(50).map((event) => event.type);
  assert.ok(events.includes('auth-start'));
  assert.ok(events.includes('auth-success'));
  assert.ok(events.includes('cash-dispensed'));
  assert.ok(events.includes('receipt-printed'));
  assert.ok(events.includes('session-ended'));

  const latest = service.getAudit(1)[0];
  assert.equal(latest.type, 'session-ended');
  assert.equal(service.state, ATM_STATES.ENDED);
});

test('no imprime recibo sin sesión autenticada', () => {
  const { service } = setup();
  const result = service.printReceipt('TX-0001');
  assert.equal(result.ok, false);
  assert.match(result.reason, /sesión activa/i);
});
