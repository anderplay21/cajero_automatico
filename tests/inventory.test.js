import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDeposit,
  applyDispense,
  composeDispense,
  createInventory,
  inventoryTotal,
} from '../src/domain/inventory.js';

test('compone el monto con la menor cantidad de billetes disponible', () => {
  const inventory = createInventory({
    100000: 10,
    50000: 10,
    20000: 10,
    10000: 10,
  });

  const combo = composeDispense(inventory, 180000);
  assert.deepEqual(combo, {
    100000: 1,
    50000: 1,
    20000: 1,
    10000: 1,
  });
});

test('usa denominaciones alternativas cuando no hay billetes grandes', () => {
  const inventory = createInventory({ 100000: 0, 50000: 4, 20000: 0, 10000: 0 });
  assert.deepEqual(composeDispense(inventory, 200000), { 50000: 4 });
});

test('rechaza montos no representables con el inventario actual', () => {
  const inventory = createInventory({ 100000: 3, 50000: 0, 20000: 0, 10000: 0 });
  assert.equal(composeDispense(inventory, 130000), null);
  assert.equal(composeDispense(inventory, 15000), null);
  assert.equal(composeDispense(inventory, 0), null);
});

test('descuenta y suma inventario por denominación', () => {
  const inventory = createInventory({ 100000: 2, 50000: 3, 20000: 0, 10000: 0 });
  assert.equal(inventoryTotal(inventory), 350000);

  applyDispense(inventory, { 100000: 1, 50000: 1 });
  assert.equal(inventory[100000], 1);
  assert.equal(inventory[50000], 2);
  assert.equal(inventoryTotal(inventory), 200000);

  applyDeposit(inventory, { 20000: 5, 10000: 3 });
  assert.equal(inventory[20000], 5);
  assert.equal(inventory[10000], 3);
  assert.equal(inventoryTotal(inventory), 330000);
});

test('impide dispensar más billetes de los disponibles', () => {
  const inventory = createInventory({ 100000: 1 });
  assert.throws(() => applyDispense(inventory, { 100000: 2 }), /Inventario insuficiente/);
});
