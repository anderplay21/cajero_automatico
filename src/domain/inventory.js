import { DENOMINATIONS } from './money.js';

function normalizeCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

export function createInventory(initial = {}) {
  const inventory = Object.fromEntries(DENOMINATIONS.map((denomination) => [denomination, 0]));
  for (const denomination of DENOMINATIONS) {
    inventory[denomination] = normalizeCount(initial[denomination]);
  }
  return inventory;
}

export function inventoryTotal(inventory) {
  return DENOMINATIONS.reduce(
    (total, denomination) => total + denomination * normalizeCount(inventory[denomination]),
    0,
  );
}

export function inventoryBills(inventory) {
  return DENOMINATIONS.reduce(
    (total, denomination) => total + normalizeCount(inventory[denomination]),
    0,
  );
}

/**
 * Encuentra la combinación de billetes disponibles que cubre el monto usando
 * la menor cantidad de billetes posible. Devuelve null si no es representable.
 */
export function composeDispense(inventory, amount) {
  const requested = Number(amount);
  if (!Number.isInteger(requested) || requested <= 0 || requested % 10000 !== 0) {
    return null;
  }

  const units = DENOMINATIONS.map((denomination) => denomination / 10000);
  const available = DENOMINATIONS.map((denomination) => normalizeCount(inventory[denomination]));
  const target = requested / 10000;
  const memo = new Map();

  function solve(index, remaining) {
    if (remaining === 0) {
      return { bills: 0, combo: {} };
    }
    if (index >= units.length || remaining < 0) {
      return null;
    }

    const key = `${index}:${remaining}`;
    if (memo.has(key)) {
      return memo.get(key);
    }

    const unit = units[index];
    const maxCount = Math.min(available[index], Math.floor(remaining / unit));
    let best = null;

    for (let count = maxCount; count >= 0; count -= 1) {
      const rest = solve(index + 1, remaining - count * unit);
      if (!rest) {
        continue;
      }
      const bills = rest.bills + count;
      if (!best || bills < best.bills) {
        best = { bills, combo: { ...rest.combo } };
        if (count > 0) {
          best.combo[unit * 10000] = count;
        }
      }
    }

    memo.set(key, best);
    return best;
  }

  const result = solve(0, target);
  return result ? result.combo : null;
}

export function applyDispense(inventory, combo) {
  for (const [denomination, count] of Object.entries(combo ?? {})) {
    const key = Number(denomination);
    if (!DENOMINATIONS.includes(key)) {
      throw new Error(`Denominación desconocida: ${denomination}`);
    }
    if (normalizeCount(inventory[key]) < Number(count)) {
      throw new Error(`Inventario insuficiente para ${denomination}`);
    }
    inventory[key] -= Number(count);
  }
  return inventory;
}

export function applyDeposit(inventory, counts) {
  for (const [denomination, count] of Object.entries(counts ?? {})) {
    const key = Number(denomination);
    if (!DENOMINATIONS.includes(key)) {
      throw new Error(`Denominación no aceptada: ${denomination}`);
    }
    const quantity = Number(count);
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error(`Cantidad inválida para ${denomination}`);
    }
    inventory[key] += quantity;
  }
  return inventory;
}
