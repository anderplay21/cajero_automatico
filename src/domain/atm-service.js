import { ATM_STATES, createStateMachine } from './state-machine.js';
import {
  applyDeposit,
  applyDispense,
  composeDispense,
  createInventory,
  inventoryTotal,
} from './inventory.js';
import { createQrStore } from './qr.js';
import { createSeedData } from './seed.js';
import { calculateCashAdvance } from './credit.js';
import { buildReceipt } from './receipts.js';
import { LIMITS } from './config.js';
import {
  DENOMINATIONS,
  TRANSACTION_LABELS,
  formatCOP,
  sumDenominations,
} from './money.js';

export function createAtmService({ clock = () => Date.now(), seedData } = {}) {
  const data = structuredClone(seedData ?? createSeedData());
  const atmId = data.atmId;
  const inventory = createInventory(data.inventory);
  const qrStore = createQrStore({ clock, ttlMs: LIMITS.qrTtlMs });
  const machine = createStateMachine();
  const auditLog = [];
  const dailyTotals = new Map();
  const transactions = [];
  let session = null;
  let lastTransaction = null;
  let sessionSeq = 0;
  let transactionSeq = 0;
  let auditSeq = 0;

  const nowIso = () => new Date(clock()).toISOString();
  const dayKey = () => {
    const date = new Date(clock());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  };

  function getCustomer(customerId) {
    return data.customers.find((customer) => customer.id === customerId) ?? null;
  }

  function getCard(cardId) {
    return data.cards.find((card) => card.id === cardId) ?? null;
  }

  function getAccount(accountId) {
    return data.accounts.find((account) => account.id === accountId) ?? null;
  }

  function publicCard(card) {
    return {
      id: card.id,
      kind: card.kind,
      masked: card.masked,
      holder: card.holder,
      expiry: card.expiry,
      network: card.network,
      status: card.status,
      customerId: card.customerId,
      creditLimit: card.creditLimit ?? null,
      availableCredit: card.availableCredit ?? null,
    };
  }

  function publicAccount(account) {
    return {
      id: account.id,
      customerId: account.customerId,
      type: account.type,
      number: account.number,
      balance: account.balance,
      currency: account.currency,
    };
  }

  function publicSession() {
    if (!session) {
      return null;
    }
    const card = getCard(session.cardId);
    const customer = getCustomer(session.customerId);
    const account = session.accountId ? getAccount(session.accountId) : null;
    return {
      id: session.id,
      channel: session.channel,
      customerId: session.customerId,
      customerName: customer?.name ?? 'Cliente',
      cardId: card?.id ?? null,
      cardKind: card?.kind ?? null,
      cardMasked: card?.masked ?? null,
      accountId: account?.id ?? null,
      accountType: account?.type ?? null,
      accountMasked: account?.number ?? null,
      pinAttempts: session.pinAttempts,
    };
  }

  function recordAudit(type, detail) {
    auditSeq += 1;
    auditLog.push({
      id: `EV-${String(auditSeq).padStart(4, '0')}`,
      at: nowIso(),
      sessionId: session?.id ?? null,
      type,
      detail,
    });
    if (auditLog.length > 500) {
      auditLog.shift();
    }
  }

  function dailyKey(kind, reference) {
    return `${dayKey()}:${kind}:${reference}`;
  }

  function getDaily(kind, reference) {
    return dailyTotals.get(dailyKey(kind, reference)) ?? 0;
  }

  function addDaily(kind, reference, amount) {
    dailyTotals.set(dailyKey(kind, reference), getDaily(kind, reference) + amount);
  }

  function remainingDaily(kind, reference, limit) {
    return Math.max(0, limit - getDaily(kind, reference));
  }

  function makeTransaction(fields) {
    transactionSeq += 1;
    const card = session ? getCard(session.cardId) : null;
    const customer = session ? getCustomer(session.customerId) : null;
    const account = session?.accountId ? getAccount(session.accountId) : null;

    const transaction = {
      id: `TX-${String(transactionSeq).padStart(4, '0')}`,
      at: nowIso(),
      sessionId: session?.id ?? null,
      channel: session?.channel ?? 'n/a',
      customerName: customer?.name ?? 'Cliente',
      cardMasked: card?.masked ?? null,
      accountMasked: account?.number ?? null,
      ...fields,
    };

    transactions.push(transaction);
    lastTransaction = transaction;
    return transaction;
  }

  function reject(type, amount, reason, extra = {}) {
    const transaction = makeTransaction({
      type,
      status: 'rechazada',
      amount,
      reason,
      ...extra,
    });
    recordAudit(
      'transaction-rejected',
      `${TRANSACTION_LABELS[type] ?? type} rechazado: ${reason}`,
    );
    return { ok: false, reason, transaction };
  }

  function ensureSession(expectedKind = 'debit') {
    if (!session || machine.state !== ATM_STATES.AUTHENTICATED) {
      return { ok: false, reason: 'Debe autenticarse antes de realizar esta operación.' };
    }
    const card = getCard(session.cardId);
    if (!card) {
      return { ok: false, reason: 'La tarjeta asociada a la sesión no está disponible.' };
    }
    if (expectedKind === 'debit' && card.kind !== 'debit') {
      return {
        ok: false,
        reason: 'La tarjeta de crédito solo permite avance de efectivo.',
      };
    }
    if (expectedKind === 'credit' && card.kind !== 'credit') {
      return {
        ok: false,
        reason: 'El avance de efectivo solo está disponible con tarjeta de crédito.',
      };
    }
    return { ok: true, card };
  }

  function startCardSession(cardId) {
    if (machine.state !== ATM_STATES.IDLE) {
      return { ok: false, reason: 'Finalice la sesión actual antes de insertar otra tarjeta.' };
    }

    const normalized = String(cardId).replace(/\s+/g, '');
    const card = data.cards.find(
      (candidate) => candidate.id === cardId || candidate.pan === normalized,
    );

    if (!card) {
      recordAudit('auth-card-rejected', 'Tarjeta no reconocida por el ATM.');
      return { ok: false, reason: 'Tarjeta no reconocida por el ATM.' };
    }
    if (card.status !== 'active') {
      recordAudit('auth-card-rejected', `Tarjeta ${card.masked} bloqueada.`);
      return { ok: false, reason: 'Tarjeta bloqueada. Contacte a su banco.' };
    }

    sessionSeq += 1;
    session = {
      id: `SES-${String(sessionSeq).padStart(4, '0')}`,
      channel: 'card',
      customerId: card.customerId,
      cardId: card.id,
      accountId: card.accountId,
      pinAttempts: 0,
      startedAt: nowIso(),
      qrToken: null,
    };
    machine.transition(ATM_STATES.AUTHENTICATING);
    recordAudit(
      'auth-start',
      `Autenticación iniciada con ${card.kind === 'debit' ? 'tarjeta débito' : 'tarjeta crédito'} ${card.masked}.`,
    );

    return {
      ok: true,
      requiresPin: true,
      masked: card.masked,
      kind: card.kind,
      customerName: getCustomer(card.customerId)?.name ?? 'Cliente',
    };
  }

  function issueQr(customerId) {
    const customer = getCustomer(customerId);
    if (!customer) {
      return { ok: false, reason: 'Cliente no encontrado para generar el QR.' };
    }
    const token = qrStore.issue(customer.id);
    recordAudit('qr-issued', `QR móvil generado para ${customer.name}.`);
    return {
      ok: true,
      token: token.token,
      expiresAt: token.expiresAt,
      customerId: customer.id,
      customerName: customer.name,
    };
  }

  function scanQr(token) {
    if (machine.state !== ATM_STATES.IDLE) {
      return { ok: false, reason: 'Finalice la sesión actual antes de escanear otro QR.' };
    }

    const result = qrStore.consume(token);
    if (!result.ok) {
      recordAudit('auth-qr-rejected', result.reason);
      return result;
    }

    const customer = getCustomer(result.customerId);
    const debitCard = data.cards.find(
      (card) =>
        card.customerId === result.customerId &&
        card.kind === 'debit' &&
        card.status === 'active',
    );

    if (!customer || !debitCard) {
      recordAudit('auth-qr-rejected', 'No hay cuenta débito activa asociada al QR.');
      return {
        ok: false,
        reason: 'No hay una cuenta débito activa asociada a este QR.',
      };
    }

    sessionSeq += 1;
    session = {
      id: `SES-${String(sessionSeq).padStart(4, '0')}`,
      channel: 'qr',
      customerId: customer.id,
      cardId: debitCard.id,
      accountId: debitCard.accountId,
      pinAttempts: 0,
      startedAt: nowIso(),
      qrToken: token,
    };
    machine.transition(ATM_STATES.AUTHENTICATING);
    recordAudit('auth-start', `Autenticación sin tarjeta iniciada para ${customer.name}.`);

    return {
      ok: true,
      requiresPin: true,
      customerName: customer.name,
      masked: debitCard.masked,
      channel: 'qr',
    };
  }

  function submitPin(pin) {
    if (machine.state !== ATM_STATES.AUTHENTICATING || !session) {
      return { ok: false, reason: 'No hay una autenticación en curso.' };
    }

    const card = getCard(session.cardId);
    if (!card) {
      return { ok: false, reason: 'Tarjeta no disponible para validar el PIN.' };
    }

    if (String(pin) === card.pin) {
      machine.transition(ATM_STATES.AUTHENTICATED);
      session.pinAttempts = 0;
      session.authenticatedAt = nowIso();
      recordAudit('auth-success', `Autenticación exitosa para ${getCustomer(session.customerId)?.name}.`);
      return {
        ok: true,
        card: publicCard(card),
        account: session.accountId ? publicAccount(getAccount(session.accountId)) : null,
        session: publicSession(),
      };
    }

    session.pinAttempts += 1;
    const remaining = LIMITS.maxPinAttempts - session.pinAttempts;
    recordAudit(
      'auth-failure',
      `PIN incorrecto (intento ${session.pinAttempts}/${LIMITS.maxPinAttempts}).`,
    );

    if (session.pinAttempts >= LIMITS.maxPinAttempts) {
      card.status = 'blocked';
      recordAudit('auth-blocked', `Tarjeta ${card.masked} bloqueada por intentos fallidos de PIN.`);
      machine.transition(ATM_STATES.ENDED);
      session = null;
      return {
        ok: false,
        blocked: true,
        reason: 'PIN incorrecto. Tarjeta bloqueada por seguridad tras 3 intentos fallidos.',
      };
    }

    return {
      ok: false,
      blocked: false,
      attemptsLeft: remaining,
      reason: `PIN incorrecto. Le quedan ${remaining} intento(s).`,
    };
  }

  function withdraw(amount) {
    const guard = ensureSession('debit');
    if (!guard.ok) {
      return guard;
    }

    const { card } = guard;
    const account = getAccount(session.accountId);

    if (!Number.isInteger(amount) || amount <= 0) {
      return reject('retiro', amount, 'Monto inválido.');
    }
    if (amount < LIMITS.minWithdrawal) {
      return reject('retiro', amount, 'El monto mínimo de retiro es $10.000.');
    }
    if (amount % 10000 !== 0) {
      return reject('retiro', amount, 'El monto debe ser múltiplo de $10.000.');
    }

    const remaining = remainingDaily(
      'withdraw',
      card.id,
      LIMITS.debitWithdrawalDaily,
    );
    if (amount > remaining) {
      return reject(
        'retiro',
        amount,
        `Supera el límite diario de retiro. Disponible hoy: ${formatCOP(remaining)}.`,
      );
    }
    if (amount > account.balance) {
      return reject('retiro', amount, 'Fondos insuficientes en la cuenta.');
    }

    const combo = composeDispense(inventory, amount);
    if (!combo) {
      return reject(
        'retiro',
        amount,
        'El ATM no cuenta con los billetes necesarios para entregar ese monto.',
      );
    }

    machine.transition(ATM_STATES.PROCESSING);
    applyDispense(inventory, combo);
    account.balance -= amount;
    addDaily('withdraw', card.id, amount);

    const transaction = makeTransaction({
      type: 'retiro',
      status: 'aprobada',
      amount,
      dispensed: combo,
      balanceAfter: account.balance,
    });

    machine.transition(ATM_STATES.AUTHENTICATED);
    recordAudit(
      'cash-dispensed',
      `Retiro aprobado por ${formatCOP(amount)}. Billetes: ${JSON.stringify(combo)}.`,
    );

    return {
      ok: true,
      transaction,
      dispensed: combo,
      balance: account.balance,
      remainingLimit: remaining - amount,
    };
  }

  function deposit(counts) {
    const guard = ensureSession('debit');
    if (!guard.ok) {
      return guard;
    }

    const account = getAccount(session.accountId);
    const normalized = {};

    for (const [rawDenomination, rawCount] of Object.entries(counts ?? {})) {
      const denomination = Number(rawDenomination);
      const count = Number(rawCount);

      if (!DENOMINATIONS.includes(denomination)) {
        return reject(
          'deposito',
          0,
          `Denominación ${rawDenomination} no aceptada. Use $10.000, $20.000, $50.000 o $100.000.`,
        );
      }
      if (!Number.isInteger(count) || count < 0) {
        return reject('deposito', 0, 'Cantidad de billetes inválida.');
      }
      if (count > 0) {
        normalized[denomination] = (normalized[denomination] ?? 0) + count;
      }
    }

    const total = sumDenominations(normalized);
    if (total <= 0) {
      return reject('deposito', 0, 'Debe ingresar al menos un billete para depositar.');
    }

    const remaining = remainingDaily(
      'deposit',
      account.id,
      LIMITS.cashDepositDaily,
    );
    if (total > remaining) {
      return reject(
        'deposito',
        total,
        `Supera el límite diario de depósito. Disponible hoy: ${formatCOP(remaining)}.`,
      );
    }

    machine.transition(ATM_STATES.PROCESSING);
    applyDeposit(inventory, normalized);
    account.balance += total;
    addDaily('deposit', account.id, total);

    const transaction = makeTransaction({
      type: 'deposito',
      status: 'aprobada',
      amount: total,
      deposited: normalized,
      balanceAfter: account.balance,
    });

    machine.transition(ATM_STATES.AUTHENTICATED);
    recordAudit(
      'deposit-received',
      `Depósito aprobado por ${formatCOP(total)}. Billetes: ${JSON.stringify(normalized)}.`,
    );

    return {
      ok: true,
      transaction,
      total,
      deposited: normalized,
      balance: account.balance,
      remainingLimit: remaining - total,
    };
  }

  function inquiry() {
    const guard = ensureSession('debit');
    if (!guard.ok) {
      return guard;
    }
    const account = getAccount(session.accountId);
    const transaction = makeTransaction({
      type: 'consulta',
      status: 'aprobada',
      amount: 0,
      balanceAfter: account.balance,
    });
    recordAudit('inquiry', `Consulta de saldo: ${formatCOP(account.balance)}.`);
    return {
      ok: true,
      transaction,
      balance: account.balance,
      account: publicAccount(account),
    };
  }

  function cashAdvance(amount) {
    const guard = ensureSession('credit');
    if (!guard.ok) {
      return guard;
    }

    const { card } = guard;

    if (!Number.isInteger(amount) || amount <= 0) {
      return reject('avance', amount, 'Monto inválido.');
    }
    if (amount < LIMITS.creditAdvanceMin) {
      return reject(
        'avance',
        amount,
        `El monto mínimo de avance es ${formatCOP(LIMITS.creditAdvanceMin)}.`,
      );
    }
    if (amount % 10000 !== 0) {
      return reject('avance', amount, 'El monto debe ser múltiplo de $10.000.');
    }

    const remaining = remainingDaily(
      'advance',
      card.id,
      LIMITS.creditAdvanceDaily,
    );
    if (amount > remaining) {
      return reject(
        'avance',
        amount,
        `Supera el tope diario de avance. Disponible hoy: ${formatCOP(remaining)}.`,
      );
    }

    const calculation = calculateCashAdvance(amount);
    if (calculation.totalCharge > card.availableCredit) {
      return reject(
        'avance',
        amount,
        `Cupo disponible insuficiente. El cargo total sería ${formatCOP(calculation.totalCharge)} y su cupo disponible es ${formatCOP(card.availableCredit)}.`,
      );
    }

    const combo = composeDispense(inventory, amount);
    if (!combo) {
      return reject(
        'avance',
        amount,
        'El ATM no cuenta con los billetes necesarios para entregar ese monto.',
      );
    }

    machine.transition(ATM_STATES.PROCESSING);
    applyDispense(inventory, combo);
    card.availableCredit -= calculation.totalCharge;
    addDaily('advance', card.id, amount);

    const transaction = makeTransaction({
      type: 'avance',
      status: 'aprobada',
      amount,
      fixedFee: calculation.fixedFee,
      variableFee: calculation.variableFee,
      commission: calculation.commission,
      monthlyInterest: calculation.monthlyInterest,
      totalCharge: calculation.totalCharge,
      interestStartAt: nowIso(),
      dispensed: combo,
      availableCreditAfter: card.availableCredit,
    });

    machine.transition(ATM_STATES.AUTHENTICATED);
    recordAudit(
      'cash-advance-approved',
      `Avance aprobado por ${formatCOP(amount)}. Comisión ${formatCOP(calculation.commission)}.`,
    );

    return {
      ok: true,
      transaction,
      dispensed: combo,
      calculation,
      availableCredit: card.availableCredit,
      remainingLimit: remaining - amount,
    };
  }

  function printReceipt(transactionId) {
    if (machine.state !== ATM_STATES.AUTHENTICATED) {
      return { ok: false, reason: 'No hay una sesión activa para imprimir el recibo.' };
    }
    const transaction = transactions.find((item) => item.id === transactionId);
    if (!transaction) {
      return { ok: false, reason: 'Transacción no encontrada.' };
    }

    machine.transition(ATM_STATES.PRINTING);
    const receipt = buildReceipt(transaction, { atmId, printedAt: nowIso() });
    recordAudit('receipt-printed', `Recibo ${receipt.receiptNumber} generado.`);
    return { ok: true, receipt };
  }

  function endSession(reason = 'user') {
    if (machine.state === ATM_STATES.ENDED) {
      return { ok: true, alreadyEnded: true };
    }
    if (!session) {
      return { ok: false, reason: 'No hay una sesión activa.' };
    }

    if (machine.state !== ATM_STATES.IDLE) {
      machine.transition(ATM_STATES.ENDED);
    }

    const ended = { sessionId: session.id, reason, channel: session.channel };
    recordAudit('session-ended', `Sesión finalizada (${reason}).`);
    session = null;
    return { ok: true, ...ended };
  }

  function reset() {
    if (machine.state === ATM_STATES.ENDED) {
      machine.transition(ATM_STATES.IDLE);
    }
    session = null;
    lastTransaction = null;
    return { ok: true };
  }

  function getRemainingLimits() {
    if (!session) {
      return null;
    }
    const card = getCard(session.cardId);
    if (!card) {
      return null;
    }
    return {
      withdraw:
        card.kind === 'debit'
          ? remainingDaily('withdraw', card.id, LIMITS.debitWithdrawalDaily)
          : null,
      deposit:
        card.kind === 'debit'
          ? remainingDaily('deposit', session.accountId, LIMITS.cashDepositDaily)
          : null,
      advance:
        card.kind === 'credit'
          ? remainingDaily('advance', card.id, LIMITS.creditAdvanceDaily)
          : null,
      availableCredit: card.kind === 'credit' ? card.availableCredit : null,
    };
  }

  function getAudit(limit = 50) {
    return auditLog.slice(-limit).reverse();
  }

  function getPublicState() {
    return {
      atmId,
      state: machine.state,
      session: publicSession(),
      customers: data.customers.map((customer) => ({ ...customer })),
      accounts: data.accounts.map(publicAccount),
      cards: data.cards.map(publicCard),
      inventory: { ...inventory },
      inventoryTotal: inventoryTotal(inventory),
      audit: getAudit(40),
      limits: getRemainingLimits(),
      lastTransaction,
    };
  }

  return {
    get state() {
      return machine.state;
    },
    get atmId() {
      return atmId;
    },
    startCardSession,
    issueQr,
    scanQr,
    submitPin,
    withdraw,
    deposit,
    inquiry,
    cashAdvance,
    printReceipt,
    endSession,
    reset,
    getAudit,
    getRemainingLimits,
    getPublicState,
    getCards: () => data.cards.map(publicCard),
    getAccounts: () => data.accounts.map(publicAccount),
    getCustomers: () => data.customers.map((customer) => ({ ...customer })),
    getTransactions: () => [...transactions],
    getInventory: () => ({ ...inventory }),
    getLastTransaction: () => lastTransaction,
  };
}
