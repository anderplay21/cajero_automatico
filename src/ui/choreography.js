import { DENOMINATIONS, formatCOP } from '../domain/money.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function center(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function createChoreographer(root, {
  reducedMotion = () => false,
  audio = null,
} = {}) {
  let active = false;
  let skipResolver = null;

  function duration(ms, reduced = 140) {
    return reducedMotion() ? reduced : ms;
  }

  async function run(step) {
    if (active) {
      return;
    }
    active = true;
    let skipped = false;
    const skipSignal = new Promise((resolve) => {
      skipResolver = () => {
        skipped = true;
        resolve();
      };
    });

    try {
      await step({
        skipped: () => skipped,
        wait: async (ms) => {
          await Promise.race([wait(duration(ms)), skipSignal]);
        },
      });
    } finally {
      skipResolver = null;
      active = false;
    }
  }

  function skip() {
    skipResolver?.();
  }

  function ensureLayer() {
    let layer = root.querySelector('.sequence-layer');
    if (!layer) {
      const host = root.querySelector('.atm-machine');
      if (!host) {
        return null;
      }
      layer = document.createElement('div');
      layer.className = 'sequence-layer';
      host.append(layer);
    }
    return layer;
  }

  async function cardInsert(cardId) {
    const card = root.querySelector(`[data-card-id="${cardId}"]`);
    const slot = root.querySelector('.card-slot .slot-mouth');
    if (!card || !slot) {
      return;
    }

    const cardRect = card.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const from = center(cardRect);
    const to = center(slotRect);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    card.classList.add('is-sequence-card');
    audio?.playClick?.();
    const servoStop = audio?.playServo?.(duration(260));

    await run(async ({ wait, skipped }) => {
      card.style.setProperty('--seq-x', `${dx}px`);
      card.style.setProperty('--seq-y', `${dy}px`);
      card.classList.add('is-inserting');
      await wait(320);
      if (!skipped()) {
        card.classList.add('is-docked');
      }
      card.classList.remove('is-inserting');
      servoStop?.();
    });

    card.style.removeProperty('--seq-x');
    card.style.removeProperty('--seq-y');
  }

  async function cardReturn(cardId) {
    const card = root.querySelector(`[data-card-id="${cardId}"]`);
    if (!card) {
      return;
    }
    card.classList.remove('is-docked');
    card.classList.add('is-returning');
    audio?.playClick?.();
    await run(async ({ wait }) => {
      await wait(260);
    });
    card.classList.remove('is-returning', 'is-sequence-card');
  }

  function createDispenseBill(denomination, index) {
    const bill = document.createElement('div');
    bill.className = `sequence-bill bill-${denomination}`;
    bill.textContent = formatCOP(denomination);
    bill.style.setProperty('--bill-i', String(index));
    bill.style.setProperty('--bill-r', `${(index % 2 === 0 ? -1 : 1) * (2 + (index % 3))}deg`);
    return bill;
  }

  async function dispense(combo = {}) {
    const layer = ensureLayer();
    const tray = root.querySelector('.tray-bills');
    const slot = root.querySelector('.cash-tray');
    if (!layer || !tray || !slot) {
      return;
    }

    const entries = [];
    for (const denomination of DENOMINATIONS) {
      const count = Number(combo?.[denomination] ?? 0);
      for (let index = 0; index < Math.min(count, 8 - entries.length); index += 1) {
        entries.push(denomination);
      }
      if (entries.length >= 8) {
        break;
      }
    }

    const total = Object.entries(combo).reduce((sum, [den, qty]) => sum + Number(den) * Number(qty), 0);
    const totalBills = Object.values(combo).reduce((sum, qty) => sum + Number(qty), 0);

    layer.innerHTML = `
      <div class="cash-gate"></div>
      <div class="cash-sequence"></div>
    `;
    const gate = layer.querySelector('.cash-gate');
    const flow = layer.querySelector('.cash-sequence');
    gate.classList.add('open');
    const servoStop = audio?.playServo?.(duration(900));

    entries.forEach((denomination, index) => {
      const bill = createDispenseBill(denomination, index);
      flow.append(bill);
    });

    await run(async ({ wait }) => {
      await wait(1000);
    });

    layer.innerHTML = '';
    servoStop?.();

    const summary = totalBills > 8 ? `<span class="tray-summary">+${totalBills - 8} billetes</span>` : '';
    tray.insertAdjacentHTML('beforeend', `<span class="tray-sequence-note">Entregado ${formatCOP(total)} ${summary}</span>`);
    await wait(duration(360));
    tray.querySelector('.tray-sequence-note')?.remove();
  }

  async function deposit(counts = {}) {
    const layer = ensureLayer();
    const slot = root.querySelector('.card-slot .slot-mouth');
    if (!layer || !slot) {
      return;
    }
    const entries = [];
    for (const denomination of DENOMINATIONS) {
      const count = Number(counts?.[denomination] ?? 0);
      for (let index = 0; index < Math.min(count, 8 - entries.length); index += 1) {
        entries.push(denomination);
      }
      if (entries.length >= 8) {
        break;
      }
    }

    const cloud = document.createElement('div');
    cloud.className = 'deposit-cloud';
    entries.forEach((denomination, index) => {
      const bill = createDispenseBill(denomination, index);
      bill.classList.add('depositing');
      cloud.append(bill);
    });

    layer.replaceChildren(cloud);
    const stopServo = audio?.playServo?.(duration(520));
    slot.classList.add('receiving');
    await run(async ({ wait }) => {
      await wait(760);
    });
    stopServo?.();
    slot.classList.remove('receiving');
    layer.innerHTML = '';
  }

  async function receipt() {
    const slot = root.querySelector('.receipt-slot-mouth');
    const layer = ensureLayer();
    if (!slot || !layer) {
      return;
    }
    layer.innerHTML = '<div class="receipt-feed"><div class="receipt-lines"></div></div>';
    slot.classList.add('printing');
    const stopPrinter = audio?.playPrinter?.(duration(1400));
    await run(async ({ wait }) => {
      await wait(1550);
    });
    stopPrinter?.();
    slot.classList.remove('printing');
    layer.innerHTML = '';
  }

  return {
    get active() {
      return active;
    },
    skip,
    cardInsert,
    cardReturn,
    dispense,
    deposit,
    receipt,
  };
}
