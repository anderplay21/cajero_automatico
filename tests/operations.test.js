import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtmService } from '../src/domain/atm-service.js';
import { createSeedData } from '../src/domain/seed.js';

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

function authenticateDebit(service) {
  service.startCardSession('card-debit-ana');
  const result = service.submitPin('1234');
  assert.equal(result.ok, true);
}

test('retira efectivo, descuenta saldo e inventario y registra la transacción', () => {
  const { service } = setup();
  authenticateDebit(service);

  const before = service.getInventory();
  const result = service.withdraw(180000);

  assert.equal(result.ok, true);
  assert.equal(result.transaction.type, 'retiro');
  assert.equal(result.transaction.status, 'aprobada');
  assert.equal(result.balance, 3_320_000);
  assert.deepEqual(result.dispensed, {
    100000: 1,
    50000: 1,
    20000: 1,
    10000: 1,
  });

  const after = service.getInventory();
  assert.equal(after[100000], before[100000] - 1);
  assert.equal(after[50000], before[50000] - 1);
  assert.equal(after[20000], before[20000] - 1);
  assert.equal(after[10000], before[10000] - 1);
});

test('rechaza retiro que supera el límite diario de $2.000.000', () => {
  const { service } = setup();
  authenticateDebit(service);

  const first = service.withdraw(2_000_000);
  assert.equal(first.ok, true);

  const second = service.withdraw(10_000);
  assert.equal(second.ok, false);
  assert.match(second.reason, /límite diario de retiro/i);
  assert.equal(second.transaction.status, 'rechazada');
});

test('rechaza retiro por fondos insuficientes', () => {
  const seedData = createSeedData();
  seedData.accounts[0].balance = 500_000;
  const { service } = setup(seedData);
  authenticateDebit(service);

  const result = service.withdraw(600_000);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Fondos insuficientes/i);
});

test('rechaza retiro cuando el ATM no puede componer el monto', () => {
  const seedData = createSeedData();
  seedData.inventory = { 100000: 5, 50000: 0, 20000: 0, 10000: 0 };
  const { service } = setup(seedData);
  authenticateDebit(service);

  const result = service.withdraw(130000);
  assert.equal(result.ok, false);
  assert.match(result.reason, /billetes necesarios/i);
});

test('acepta depósito con denominaciones válidas y actualiza inventario y saldo', () => {
  const { service } = setup();
  authenticateDebit(service);
  const before = service.getInventory();

  const result = service.deposit({ 100000: 2, 50000: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.total, 250000);
  assert.equal(result.balance, 3_750_000);

  const after = service.getInventory();
  assert.equal(after[100000], before[100000] + 2);
  assert.equal(after[50000], before[50000] + 1);
});

test('rechaza depósito con denominación no aceptada o monto cero', () => {
  const { service } = setup();
  authenticateDebit(service);

  const invalid = service.deposit({ 30000: 1 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /no aceptada/i);

  const empty = service.deposit({ 100000: 0 });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /al menos un billete/i);
});

test('rechaza depósito por encima del tope diario de $5.000.000', () => {
  const { service } = setup();
  authenticateDebit(service);

  const result = service.deposit({ 100000: 51 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /límite diario de depósito/i);
});

test('la consulta de saldo refleja el saldo posterior a una transacción', () => {
  const { service } = setup();
  authenticateDebit(service);
  service.withdraw(100000);

  const result = service.inquiry();
  assert.equal(result.ok, true);
  assert.equal(result.balance, 3_400_000);
  assert.equal(result.transaction.type, 'consulta');
  assert.equal(result.transaction.balanceAfter, 3_400_000);
});
