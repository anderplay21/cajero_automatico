import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtmService } from '../src/domain/atm-service.js';
import { createSeedData } from '../src/domain/seed.js';
import { calculateCashAdvance } from '../src/domain/credit.js';

function setup(seedData) {
  let current = Date.parse('2026-10-27T10:00:00.000Z');
  const service = createAtmService({ clock: () => current, seedData });
  return {
    service,
    advance(ms) {
      current += ms;
    },
  };
}

function authenticateCredit(service) {
  service.startCardSession('card-credit-ana');
  const result = service.submitPin('4321');
  assert.equal(result.ok, true);
}

test('calcula comisión fija, variable e interés mensual del avance', () => {
  const calculation = calculateCashAdvance(100000);
  assert.equal(calculation.fixedFee, 8_000);
  assert.equal(calculation.variableFee, 4_000);
  assert.equal(calculation.commission, 12_000);
  assert.equal(calculation.monthlyInterest, 2_300);
  assert.equal(calculation.totalCharge, 112_000);
});

test('aprueba avance de crédito y reduce el cupo disponible por el cargo total', () => {
  const { service } = setup();
  authenticateCredit(service);

  const result = service.cashAdvance(100000);

  assert.equal(result.ok, true);
  assert.equal(result.transaction.type, 'avance');
  assert.equal(result.transaction.commission, 12_000);
  assert.equal(result.transaction.monthlyInterest, 2_300);
  assert.equal(result.transaction.totalCharge, 112_000);
  assert.equal(result.transaction.interestStartAt, '2026-10-27T10:00:00.000Z');
  assert.equal(result.availableCredit, 1_888_000);
  assert.equal(service.getCards().find((card) => card.kind === 'credit').availableCredit, 1_888_000);
});

test('rechaza avance por debajo del mínimo de $20.000', () => {
  const { service } = setup();
  authenticateCredit(service);

  const result = service.cashAdvance(10000);
  assert.equal(result.ok, false);
  assert.match(result.reason, /mínimo de avance/i);
});

test('rechaza avance que no es múltiplo de $10.000', () => {
  const { service } = setup();
  authenticateCredit(service);

  const result = service.cashAdvance(25000);
  assert.equal(result.ok, false);
  assert.match(result.reason, /múltiplo de \$10.000/i);
});

test('rechaza avance por encima del tope diario de $1.000.000', () => {
  const { service } = setup();
  authenticateCredit(service);

  assert.equal(service.cashAdvance(1_000_000).ok, true);
  const second = service.cashAdvance(20_000);
  assert.equal(second.ok, false);
  assert.match(second.reason, /tope diario de avance/i);
});

test('rechaza avance cuando el cupo no cubre el cargo total', () => {
  const seedData = createSeedData();
  seedData.cards[1].availableCredit = 50_000;
  const { service } = setup(seedData);
  authenticateCredit(service);

  const result = service.cashAdvance(100000);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Cupo disponible insuficiente/i);
});

test('tarjeta de crédito no permite retiro ni depósito', () => {
  const { service } = setup();
  authenticateCredit(service);

  const withdrawal = service.withdraw(100000);
  assert.equal(withdrawal.ok, false);
  assert.match(withdrawal.reason, /solo permite avance de efectivo/i);

  const deposit = service.deposit({ 100000: 1 });
  assert.equal(deposit.ok, false);
  assert.match(deposit.reason, /solo permite avance de efectivo/i);
});
