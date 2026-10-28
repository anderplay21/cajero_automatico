import {
  DENOMINATIONS,
  DENOMINATION_LABELS,
  TRANSACTION_LABELS,
  formatBills,
  formatCOP,
  sumDenominations,
} from '../domain/money.js';
import { LIMITS } from '../domain/config.js';
import { drawPseudoQr } from './qr-canvas.js';
import { attachKineticDrag } from './kinetic-drag.js';
import { createAudioEngine } from './audio-engine.js';
import { createChoreographer } from './choreography.js';

const STATE_LABELS = {
  idle: 'En espera',
  authenticating: 'Autenticando',
  authenticated: 'Sesión activa',
  'transaction-processing': 'Procesando',
  'printing-receipt': 'Imprimiendo',
  'session-ended': 'Finalizada',
};

const AUDIT_LABELS = {
  'auth-start': 'Autenticación',
  'auth-card-rejected': 'Tarjeta rechazada',
  'auth-qr-rejected': 'QR rechazado',
  'auth-success': 'Acceso autorizado',
  'auth-failure': 'PIN fallido',
  'auth-blocked': 'Tarjeta bloqueada',
  'qr-issued': 'QR generado',
  'cash-dispensed': 'Efectivo entregado',
  'cash-advance-approved': 'Avance aprobado',
  'deposit-received': 'Depósito recibido',
  'transaction-rejected': 'Transacción rechazada',
  inquiry: 'Consulta de saldo',
  'receipt-printed': 'Recibo impreso',
  'session-ended': 'Sesión finalizada',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortTime(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function firstName(name) {
  return String(name ?? 'Cliente').split(' ')[0];
}

function auditTone(type) {
  if (/rejected|failure|blocked/.test(type)) {
    return 'danger';
  }
  if (/success|approved|dispensed|received|printed/.test(type)) {
    return 'success';
  }
  return 'info';
}

export function mountApp(root, service, { onReset } = {}) {
  const controller = new AbortController();
  let toastTimer = null;
  let invalidTimer = null;
  let tickTimer = null;
  let lastActivity = Date.now();
  let lastPointerKey = null;
  let lastPointerKeyAt = 0;
  let pauseSessionTimeout = false;
  let insertedCardId = null;

  const reduceMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  const prefersReduced = () => reduceMotionMedia.matches;

  const audioEngine = createAudioEngine();
  const choreographer = createChoreographer(root, {
    reducedMotion: prefersReduced,
    audio: audioEngine,
  });

  let ui = {
    screen: 'welcome',
    flow: null,
    pin: '',
    amountInput: '',
    depositCounts: Object.fromEntries(DENOMINATIONS.map((denomination) => [denomination, 0])),
    result: null,
    receipt: null,
    qr: null,
    qrExpiredRendered: false,
    toast: null,
    error: null,
    endedInfo: null,
    busy: false,
    lastDispensed: null,
    invalidDrop: false,
    dragging: null,
    audioEnabled: audioEngine.isEnabled(),
  };

  const state = () => service.getPublicState();
  const touch = () => {
    lastActivity = Date.now();
  };

  function resetUi() {
    ui = {
      screen: 'welcome',
      flow: null,
      pin: '',
      amountInput: '',
      depositCounts: Object.fromEntries(DENOMINATIONS.map((denomination) => [denomination, 0])),
      result: null,
      receipt: null,
      qr: null,
      qrExpiredRendered: false,
      toast: ui.toast,
      error: null,
      endedInfo: null,
      busy: false,
      lastDispensed: null,
      invalidDrop: false,
      dragging: null,
      audioEnabled: ui.audioEnabled,
    };
  }

  function showToast(message) {
    ui.toast = message;
    render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast = null;
      render();
    }, 3200);
  }

  function invalidDrop(message) {
    ui.invalidDrop = true;
    showToast(message);
    clearTimeout(invalidTimer);
    invalidTimer = setTimeout(() => {
      ui.invalidDrop = false;
      render();
    }, 700);
  }

  function render() {
    const snapshot = state();
    root.innerHTML = `
      <div class="app-shell ${ui.invalidDrop ? 'drop-error' : ''}">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark">T</div>
            <div class="brand-copy">
              <h1>Sistema ATM <span>TecBank201D</span></h1>
              <p>Simulación bancaria integral · Pesos colombianos</p>
            </div>
          </div>
          <div class="topbar-meta">
            <span class="online-dot"></span>
            <span class="online-label">En línea</span>
            <time data-clock>--:--:--</time>
            <button type="button" class="ghost small" data-action="toggle-audio" aria-pressed="${ui.audioEnabled ? 'true' : 'false'}">
              ${ui.audioEnabled ? 'Audio ON' : 'Audio OFF'}
            </button>
            <button type="button" class="ghost small" data-action="reset-sim">Reiniciar simulación</button>
          </div>
        </header>

        <main class="workspace">
          <section class="scene-column">
            <div class="section-label"><span>01</span> Escenario ATM 3D</div>
            <div class="atm-stage">
              <div class="atm-world">
                ${renderAtm(snapshot)}
                ${renderWallet(snapshot)}
              </div>
            </div>
          </section>

          <aside class="dashboard-column">
            <div class="side-grid">
              ${renderGuide(snapshot)}
              ${renderCassettes(snapshot)}
            </div>
            ${renderAudit(snapshot)}
          </aside>
        </main>

        <footer class="page-footer">
          <span>TecBank201D · Simulador educativo con reglas operativas de banca real</span>
          <span>Arrastra objetos al cajero o usa los botones de respaldo</span>
        </footer>
      </div>
      <div class="toast-region" aria-live="polite">
        ${ui.toast ? `<div class="toast">${escapeHtml(ui.toast)}</div>` : ''}
      </div>
    `;

    paintQr();
    updateClock();
  }

  function renderAtm(snapshot) {
    return `
      <div class="atm-shell-3d" data-atm-state="${snapshot.state}">
      <div class="atm-machine atm-state-${snapshot.state}" data-atm-state="${snapshot.state}">
        <div class="atm-crown">
          <div class="atm-bank">
            <span class="atm-bank-mark">T</span>
            <div>
              <strong>TecBank</strong>
              <small>ATM ${snapshot.atmId}</small>
            </div>
          </div>
          <div class="atm-led ${snapshot.state === 'idle' ? 'is-on' : ''}">
            <span></span>${STATE_LABELS[snapshot.state] ?? snapshot.state}
          </div>
        </div>

        <div class="atm-screen" aria-live="polite">
          ${renderScreen(snapshot)}
        </div>

        <div class="atm-console">
          <div class="console-left">
            <div class="slot card-slot" data-drop="card" aria-label="Ranura para tarjeta">
              <div class="slot-head"><span class="slot-led"></span><span>Lector de tarjeta</span></div>
              <div class="slot-mouth"></div>
              <span class="slot-hint">Suelta aquí una tarjeta</span>
            </div>

            <div class="slot qr-slot" data-drop="phone" aria-label="Lector de código QR">
              <div class="slot-head"><span class="qr-glyph">▦</span><span>Lector QR sin tarjeta</span></div>
              <div class="qr-window"></div>
              <span class="slot-hint">Suelta aquí el móvil</span>
            </div>

            <div class="cash-tray">
              <div class="tray-head">
                <span>Bandeja de efectivo</span>
                <strong>${ui.lastDispensed ? formatCOP(sumDenominations(ui.lastDispensed)) : 'Vacía'}</strong>
              </div>
              <div class="tray-bills">${renderDispensedBills(ui.lastDispensed)}</div>
            </div>
          </div>

          <div class="console-right">
            ${renderKeypad()}
            <div class="receipt-slot">
              <span>Recibo</span>
              <div class="receipt-slot-mouth ${ui.receipt ? 'has-receipt' : ''}"></div>
            </div>
          </div>
        </div>
        <div class="sequence-layer" aria-hidden="true"></div>
      </div>
      </div>
    `;
  }

  function renderDispensedBills(dispensed) {
    if (!dispensed) {
      return '<span class="tray-empty">Sin entrega reciente</span>';
    }
    return DENOMINATIONS.filter((denomination) => dispensed[denomination] > 0)
      .map(
        (denomination) => `
          <span class="bill bill-${denomination}">
            ${dispensed[denomination]} × ${DENOMINATION_LABELS[denomination]}
          </span>
        `,
      )
      .join('');
  }

  function keypadEnabled() {
    return ui.screen === 'pin' || ui.screen === 'amount';
  }

  function renderKeypad() {
    const enabled = keypadEnabled();
    const keys = [];
    for (let number = 1; number <= 9; number += 1) {
      keys.push({ key: String(number), label: String(number) });
    }
    keys.push({ key: 'back', label: '⌫' }, { key: '0', label: '0' }, { key: 'ok', label: 'OK' });

    return `
      <div class="keypad ${enabled ? '' : 'is-disabled'}" aria-label="Teclado numérico">
        ${keys
          .map(
            (item) => `
              <button type="button" class="key" data-key="${item.key}" ${enabled ? '' : 'disabled'} aria-label="${item.label}">
                ${item.label}
              </button>
            `,
          )
          .join('')}
      </div>
      <button type="button" class="cancel-key" data-action="cancel" ${enabled || ui.screen === 'menu' ? '' : 'disabled'}>
        Cancelar
      </button>
    `;
  }

  function renderScreen(snapshot) {
    if (ui.screen === 'processing') {
      return `
        <div class="screen processing-screen">
          <div class="spinner"></div>
          <h2>Procesando operación</h2>
          <p>Validando reglas de negocio, cupos y disponibilidad de efectivo...</p>
        </div>
      `;
    }

    if (ui.screen === 'pin' && snapshot.session) {
      return renderPin(snapshot);
    }
    if (ui.screen === 'menu' && snapshot.session) {
      return renderMenu(snapshot);
    }
    if (ui.screen === 'amount' && snapshot.session) {
      return renderAmount(snapshot);
    }
    if (ui.screen === 'deposit' && snapshot.session) {
      return renderDeposit(snapshot);
    }
    if (ui.screen === 'result' && ui.result) {
      return renderResult();
    }
    if (ui.screen === 'receipt' && ui.receipt) {
      return renderReceipt();
    }
    if (ui.screen === 'ended') {
      return renderEnded();
    }
    return renderWelcome();
  }

  function renderWelcome() {
    return `
      <div class="screen welcome-screen">
        <div class="screen-brand">
          <span class="mini-mark">T</span>
          <div>TecBank<strong>201D</strong></div>
        </div>
        <h2>Bienvenido a su cajero</h2>
        <p class="screen-lead">Inserte una tarjeta o use el móvil para operar sin tarjeta.</p>

        <div class="welcome-grid">
          <div class="welcome-card">
            <span class="kicker">Con tarjeta</span>
            <strong>Débito o crédito</strong>
            <small>Arrastre la tarjeta a la ranura del ATM.</small>
          </div>
          <div class="welcome-card">
            <span class="kicker">Sin tarjeta</span>
            <strong>QR + PIN</strong>
            <small>Genere un QR en el móvil y arrástrelo al lector.</small>
          </div>
        </div>

        <div class="welcome-ops">
          <div><strong>Retiros</strong><span>Hasta $2.000.000 por día</span></div>
          <div><strong>Depósitos</strong><span>Hasta $5.000.000 por día</span></div>
          <div><strong>Avances</strong><span>Crédito con comisión e interés</span></div>
        </div>

        <div class="screen-footer"><span class="pulse-dot"></span> Esperando tarjeta o código QR...</div>
      </div>
    `;
  }

  function renderPin(snapshot) {
    const session = snapshot.session;
    return `
      <div class="screen pin-screen">
        <div class="screen-head">
          <span class="kicker">${session.channel === 'qr' ? 'Acceso sin tarjeta' : 'Acceso con tarjeta'}</span>
          <h2>Ingrese su PIN</h2>
          <p>${escapeHtml(session.customerName)} · ${escapeHtml(session.cardMasked ?? '')}</p>
        </div>

        <div class="pin-visual">
          <div class="pin-card">${escapeHtml(session.cardMasked ?? 'Sesión QR')}</div>
          <div class="pin-dots" aria-label="PIN ingresado">
            ${Array.from({ length: 4 })
              .map((_, index) => `<span class="${index < ui.pin.length ? 'filled' : ''}"></span>`)
              .join('')}
          </div>
        </div>

        ${ui.error ? `<div class="screen-alert">${escapeHtml(ui.error)}</div>` : ''}
        <p class="screen-hint">
          Use el teclado numérico del cajero.
          ${session.pinAttempts > 0 ? `Intentos fallidos en esta sesión: ${session.pinAttempts}.` : 'Máximo 3 intentos.'}
        </p>
      </div>
    `;
  }

  function renderMenu(snapshot) {
    const session = snapshot.session;
    const account = snapshot.accounts.find((item) => item.id === session.accountId);
    const isCredit = session.cardKind === 'credit';
    const limits = snapshot.limits ?? {};

    return `
      <div class="screen menu-screen">
        <div class="screen-head">
          <span class="kicker">Sesión activa</span>
          <h2>Hola, ${escapeHtml(firstName(session.customerName))}</h2>
          <p>${isCredit ? 'Tarjeta de crédito' : 'Tarjeta débito'} · ${escapeHtml(session.cardMasked ?? '')}</p>
        </div>

        <div class="menu-balance">
          <div>
            <span>${isCredit ? 'Cupo disponible' : 'Saldo disponible'}</span>
            <strong>${
              isCredit
                ? formatCOP(limits.availableCredit ?? 0)
                : formatCOP(account?.balance ?? 0)
            }</strong>
          </div>
          <span class="menu-timer">Cierre por inactividad en <b data-session-timer>120s</b></span>
        </div>

        <div class="menu-grid">
          ${
            isCredit
              ? `
                <button type="button" class="menu-btn accent" data-action="menu-advance">
                  <span class="menu-icon">↑</span>
                  <span><strong>Avance de efectivo</strong><small>Comisión $8.000 + 4% · Interés 2,3% M.V.</small></span>
                </button>
              `
              : `
                <button type="button" class="menu-btn" data-action="menu-withdraw">
                  <span class="menu-icon">↓</span>
                  <span><strong>Retirar efectivo</strong><small>Disponible hoy ${formatCOP(limits.withdraw ?? 0)}</small></span>
                </button>
                <button type="button" class="menu-btn" data-action="menu-deposit">
                  <span class="menu-icon">＋</span>
                  <span><strong>Depositar efectivo</strong><small>Disponible hoy ${formatCOP(limits.deposit ?? 0)}</small></span>
                </button>
                <button type="button" class="menu-btn" data-action="menu-balance">
                  <span class="menu-icon">≡</span>
                  <span><strong>Consultar saldo</strong><small>Ver saldo y último movimiento</small></span>
                </button>
              `
          }
          <button type="button" class="menu-btn danger" data-action="menu-finish">
            <span class="menu-icon">↙</span>
            <span><strong>Finalizar sesión</strong><small>Devolver tarjeta y cerrar</small></span>
          </button>
        </div>

        <div class="screen-footer">
          ${
            isCredit
              ? `Avances disponibles hoy: ${formatCOP(limits.advance ?? 0)} · Sin período de gracia`
              : `Retiro mínimo $10.000 · Billetes de $10.000, $20.000, $50.000 y $100.000`
          }
        </div>
      </div>
    `;
  }

  function renderAmount(snapshot) {
    const isAdvance = ui.flow === 'avance';
    const limits = snapshot.limits ?? {};
    const quickValues = isAdvance
      ? [100000, 200000, 500000, 1000000]
      : [50000, 100000, 200000, 500000];

    return `
      <div class="screen amount-screen">
        <div class="screen-head">
          <span class="kicker">${isAdvance ? 'Avance de efectivo' : 'Retiro de efectivo'}</span>
          <h2>${isAdvance ? '¿Cuánto desea avanzar?' : '¿Cuánto desea retirar?'}</h2>
        </div>

        <div class="amount-display">${formatCOP(Number(ui.amountInput || 0))}</div>

        <div class="quick-amounts">
          ${quickValues
            .map(
              (value) => `
                <button type="button" data-action="quick-amount" data-amount="${value}">
                  ${formatCOP(value)}
                </button>
              `,
            )
            .join('')}
        </div>

        ${
          ui.error
            ? `<div class="screen-alert">${escapeHtml(ui.error)}</div>`
            : `<p class="screen-hint">${
                isAdvance
                  ? `Mínimo ${formatCOP(LIMITS.creditAdvanceMin)} · Disponible hoy ${formatCOP(limits.advance ?? 0)} · Comisión $8.000 + 4% · Interés 2,3% M.V.`
                  : `Múltiplos de $10.000 · Disponible hoy ${formatCOP(limits.withdraw ?? 0)}`
              }</p>`
        }
      </div>
    `;
  }

  function renderDeposit(snapshot) {
    const total = sumDenominations(ui.depositCounts);
    const limits = snapshot.limits ?? {};

    return `
      <div class="screen deposit-screen">
        <div class="screen-head">
          <span class="kicker">Depósito en efectivo</span>
          <h2>Cuente sus billetes</h2>
          <p>Seleccione la cantidad por denominación. Disponible hoy: ${formatCOP(limits.deposit ?? 0)}.</p>
        </div>

        <div class="denom-list">
          ${DENOMINATIONS.map((denomination) => {
            const count = ui.depositCounts[denomination] ?? 0;
            return `
              <div class="denom-row">
                <div class="denom-label">
                  <strong>${DENOMINATION_LABELS[denomination]}</strong>
                  <small>${formatCOP(denomination * count)}</small>
                </div>
                <div class="stepper">
                  <button type="button" data-action="dep-minus" data-denom="${denomination}" aria-label="Quitar billete de ${DENOMINATION_LABELS[denomination]}">−</button>
                  <span>${count}</span>
                  <button type="button" data-action="dep-plus" data-denom="${denomination}" aria-label="Agregar billete de ${DENOMINATION_LABELS[denomination]}">+</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="deposit-total">
          <span>Total a depositar</span>
          <strong>${formatCOP(total)}</strong>
        </div>

        ${ui.error ? `<div class="screen-alert">${escapeHtml(ui.error)}</div>` : ''}

        <div class="deposit-actions">
          <button type="button" class="ghost" data-action="dep-clear">Vaciar</button>
          <button type="button" class="primary" data-action="dep-confirm" ${total === 0 ? 'disabled' : ''}>Confirmar depósito</button>
        </div>
      </div>
    `;
  }

  function renderResult() {
    const result = ui.result;
    return `
      <div class="screen result-screen">
        <div class="result-icon ${result.ok ? 'ok' : 'fail'}">${result.ok ? '✓' : '×'}</div>
        <h2>${escapeHtml(result.title)}</h2>
        <p class="result-subtitle">${escapeHtml(result.subtitle ?? '')}</p>

        <div class="result-lines">
          ${result.lines
            .map(
              (line) => `
                <div class="result-line">
                  <span>${escapeHtml(line.label)}</span>
                  <strong>${escapeHtml(line.value)}</strong>
                </div>
              `,
            )
            .join('')}
        </div>

        ${result.note ? `<div class="screen-alert soft">${escapeHtml(result.note)}</div>` : ''}

        <div class="result-actions">
          <button type="button" class="primary" data-action="result-print">Imprimir recibo</button>
          <button type="button" class="ghost" data-action="result-continue">Continuar</button>
        </div>
      </div>
    `;
  }

  function receiptRows(receipt) {
    const rows = [
      ['ATM', receipt.atmId],
      ['Recibo', receipt.receiptNumber],
      ['Fecha', new Date(receipt.transactionAt).toLocaleString('es-CO')],
      ['Operación', receipt.operationId],
      ['Tipo', receipt.typeLabel],
      ['Canal', receipt.channel === 'qr' ? 'Sin tarjeta (QR)' : 'Tarjeta'],
      ['Cliente', receipt.customerName],
      ['Cuenta', receipt.accountMasked ?? '—'],
      ['Tarjeta', receipt.cardMasked ?? '—'],
      ['Estado', String(receipt.status).toUpperCase()],
      ['Monto', formatCOP(receipt.amount)],
    ];

    if (receipt.fixedFee) rows.push(['Comisión fija', formatCOP(receipt.fixedFee)]);
    if (receipt.variableFee) rows.push(['Comisión 4%', formatCOP(receipt.variableFee)]);
    if (receipt.commission) rows.push(['Comisión total', formatCOP(receipt.commission)]);
    if (receipt.monthlyInterest) rows.push(['Interés mensual', formatCOP(receipt.monthlyInterest)]);
    if (receipt.balanceAfter !== null) rows.push(['Saldo después', formatCOP(receipt.balanceAfter)]);
    if (receipt.availableCreditAfter !== null) {
      rows.push(['Cupo después', formatCOP(receipt.availableCreditAfter)]);
    }
    if (receipt.dispensed) rows.push(['Billetes', formatBills(receipt.dispensed)]);
    if (receipt.deposited) rows.push(['Billetes', formatBills(receipt.deposited)]);
    if (receipt.reason) rows.push(['Motivo', receipt.reason]);

    return rows;
  }

  function renderReceipt() {
    const receipt = ui.receipt;
    return `
      <div class="screen receipt-screen">
        <div class="receipt-paper" id="receipt-paper">
          <div class="receipt-brand">TECBANK <span>201D</span></div>
          <div class="receipt-sub">Comprobante de operación</div>
          <div class="receipt-divider"></div>
          ${receiptRows(receipt)
            .map(
              ([label, value]) => `
                <div class="receipt-row">
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(value)}</strong>
                </div>
              `,
            )
            .join('')}
          <div class="receipt-divider"></div>
          <div class="receipt-thanks">Gracias por usar TecBank</div>
          <div class="receipt-barcode" aria-hidden="true"></div>
          <div class="receipt-code">${escapeHtml(receipt.operationId)}</div>
        </div>

        <div class="result-actions">
          <button type="button" class="primary" data-action="receipt-print">Imprimir</button>
          <button type="button" class="ghost" data-action="receipt-finish">Finalizar</button>
        </div>
      </div>
    `;
  }

  function renderEnded() {
    return `
      <div class="screen ended-screen">
        <div class="result-icon ok">✓</div>
        <h2>Sesión finalizada</h2>
        <p class="result-subtitle">${escapeHtml(ui.endedInfo?.reason ?? 'Gracias por usar TecBank201D.')}</p>
        <div class="screen-alert soft">Retire su tarjeta, su efectivo y su recibo antes de retirarse.</div>
        <button type="button" class="primary" data-action="new-session">Nueva operación</button>
      </div>
    `;
  }

  function renderWallet(snapshot) {
    const debit = snapshot.cards.find((card) => card.kind === 'debit');
    const credit = snapshot.cards.find((card) => card.kind === 'credit');
    const customer = snapshot.customers[0];
    const account = snapshot.accounts[0];
    const qrSeconds = ui.qr
      ? Math.max(0, Math.ceil((ui.qr.expiresAt - Date.now()) / 1000))
      : 0;
    const qrExpired = Boolean(ui.qr && qrSeconds <= 0);

    return `
      <section class="panel wallet-panel">
        <div class="panel-head">
          <div>
            <span class="kicker">Billetera</span>
            <h2>Objetos del cliente</h2>
          </div>
          <span class="drag-note">Arrastra al cajero</span>
        </div>

        <div class="cards-row">
          ${renderBankCard(debit)}
          ${renderBankCard(credit)}
        </div>

        <div class="phone-wrap">
          <div class="phone" data-draggable-kind="phone" data-draggable-id="phone">
            <div class="phone-grip" data-drag-phone title="Arrastra el móvil al lector QR">
              <span></span><span class="phone-camera"></span><span></span>
            </div>
            <div class="phone-screen">
              <div class="phone-status"><time data-clock>--:--</time><span>▮▮▮</span></div>
              <div class="phone-app">
                <div class="phone-brand">TecBank <span>Móvil</span></div>
                <h3>${escapeHtml(customer?.name ?? 'Cliente')}</h3>
                <p>${escapeHtml(account?.type ?? 'Cuenta')} ${escapeHtml(account?.number ?? '')}</p>

                <div class="qr-box ${qrExpired ? 'is-expired' : ''}">
                  ${
                    ui.qr
                      ? '<canvas id="phone-qr" width="176" height="176" aria-label="Código QR temporal"></canvas>'
                      : '<div class="qr-empty">Sin QR activo</div>'
                  }
                  ${qrExpired ? '<div class="qr-overlay">VENCIDO</div>' : ''}
                </div>

                <div class="qr-meta">
                  <span>${ui.qr ? (qrExpired ? 'Código vencido' : `Vence en ${qrSeconds}s`) : 'Genera un código temporal'}</span>
                  <b data-qr-countdown>${ui.qr ? (qrExpired ? 'Vencido' : `${qrSeconds}s`) : ''}</b>
                </div>

                <button type="button" class="primary small" data-action="generate-qr">
                  ${ui.qr ? 'Regenerar QR' : 'Generar QR'}
                </button>
                <button type="button" class="ghost small" data-action="scan-qr">Escanear en el ATM</button>
                <p class="phone-hint">Arrastra este móvil al lector QR del cajero.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderBankCard(card) {
    if (!card) {
      return '';
    }
    const isCredit = card.kind === 'credit';
    const isInserted = insertedCardId === card.id;
    return `
      <article class="bank-card ${card.kind} ${card.status !== 'active' ? 'is-blocked' : ''} ${isInserted ? 'is-docked' : ''}" data-card-id="${card.id}" data-draggable-kind="card" data-draggable-id="${card.id}">
        <div class="card-shine"></div>
        <div class="card-top">
          <span class="card-network">${escapeHtml(card.network)}</span>
          <span class="card-kind">${isCredit ? 'CRÉDITO' : 'DÉBITO'}</span>
        </div>
        <div class="card-chip"></div>
        <div class="card-number">${escapeHtml(card.masked)}</div>
        <div class="card-extra">
          ${isCredit ? `Cupo disp. ${formatCOP(card.availableCredit ?? 0)}` : 'Cuenta de ahorros'}
        </div>
        <div class="card-bottom">
          <div><small>TITULAR</small><strong>${escapeHtml(card.holder)}</strong></div>
          <div><small>VENCE</small><strong>${escapeHtml(card.expiry)}</strong></div>
        </div>
        ${card.status !== 'active' ? '<div class="card-blocked">BLOQUEADA</div>' : ''}
        <button type="button" class="card-insert" data-action="insert-card" data-card-id="${card.id}">
          Insertar
        </button>
      </article>
    `;
  }

  function renderGuide(snapshot) {
    const debit = snapshot.cards.find((card) => card.kind === 'debit');
    const credit = snapshot.cards.find((card) => card.kind === 'credit');
    const account = snapshot.accounts[0];
    return `
      <section class="panel guide-panel">
        <div class="panel-head">
          <div>
            <span class="kicker">Modo demo</span>
            <h2>Credenciales</h2>
          </div>
        </div>
        <div class="guide-row">
          <span class="pill debit">Débito</span>
          <div><strong>4512 •••• 8834</strong><small>PIN 1234 · Saldo ${formatCOP(account?.balance ?? 0)}</small></div>
        </div>
        <div class="guide-row">
          <span class="pill credit">Crédito</span>
          <div><strong>5214 •••• 2017</strong><small>PIN 4321 · Cupo disp. ${formatCOP(credit?.availableCredit ?? 0)}</small></div>
        </div>
        <div class="guide-row">
          <span class="pill phone">Móvil</span>
          <div><strong>QR + PIN 1234</strong><small>Genere el QR y arrástrelo al lector</small></div>
        </div>
      </section>
    `;
  }

  function renderCassettes(snapshot) {
    const maxReference = 80;
    return `
      <section class="panel cassettes-panel">
        <div class="panel-head">
          <div>
            <span class="kicker">Efectivo</span>
            <h2>Casetes</h2>
          </div>
          <span class="panel-total">${formatCOP(snapshot.inventoryTotal)}</span>
        </div>
        <div class="cassette-list">
          ${DENOMINATIONS.map((denomination) => {
            const count = snapshot.inventory[denomination] ?? 0;
            const percentage = Math.min(100, Math.round((count / maxReference) * 100));
            return `
              <div class="cassette">
                <div class="cassette-head">
                  <span>${DENOMINATION_LABELS[denomination]}</span>
                  <strong>${count}</strong>
                </div>
                <div class="bar"><span style="width:${percentage}%"></span></div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderAudit(snapshot) {
    return `
      <section class="panel audit-panel">
        <div class="panel-head">
          <div>
            <span class="kicker">Auditoría</span>
            <h2>Registro de eventos</h2>
          </div>
          <span class="drag-note">${snapshot.audit.length} eventos</span>
        </div>
        <ul class="audit-list">
          ${
            snapshot.audit.length
              ? snapshot.audit
                  .slice(0, 14)
                  .map(
                    (event) => `
                      <li>
                        <span class="audit-time">${shortTime(event.at)}</span>
                        <span class="audit-badge ${auditTone(event.type)}">${escapeHtml(
                          AUDIT_LABELS[event.type] ?? event.type,
                        )}</span>
                        <p>${escapeHtml(event.detail)}</p>
                      </li>
                    `,
                  )
                  .join('')
              : '<li class="audit-empty">Sin eventos registrados. Inicie una operación.</li>'
          }
        </ul>
      </section>
    `;
  }

  function paintQr() {
    if (!ui.qr) {
      return;
    }
    const canvas = root.querySelector('#phone-qr');
    if (canvas) {
      drawPseudoQr(canvas, ui.qr.token);
    }
  }

  function updateClock() {
    const now = new Date();
    root.querySelectorAll('[data-clock]').forEach((element) => {
      element.textContent = now.toLocaleTimeString('es-CO', { hour12: false });
    });

    if (ui.qr) {
      const seconds = Math.max(0, Math.ceil((ui.qr.expiresAt - now.getTime()) / 1000));
      root.querySelectorAll('[data-qr-countdown]').forEach((element) => {
        element.textContent = seconds > 0 ? `${seconds}s` : 'Vencido';
      });
    }

    if (service.state === 'authenticated') {
      const remaining = Math.max(
        0,
        Math.ceil((LIMITS.sessionTimeoutMs - (Date.now() - lastActivity)) / 1000),
      );
      root.querySelectorAll('[data-session-timer]').forEach((element) => {
        element.textContent = `${remaining}s`;
      });
    }
  }

  function submitPin() {
    if (ui.busy || ui.screen !== 'pin') {
      return;
    }
    const result = service.submitPin(ui.pin);
    if (result.ok) {
      ui.pin = '';
      ui.error = null;
      ui.screen = 'menu';
      touch();
      render();
      return;
    }
    if (result.blocked) {
      ui.pin = '';
      ui.screen = 'ended';
      ui.endedInfo = { reason: result.reason };
      render();
      return;
    }
    ui.pin = '';
    ui.error = result.reason;
    render();
    showToast(result.reason);
  }

  async function startCard(cardId) {
    if (ui.busy) {
      return;
    }
    if (ui.screen !== 'welcome') {
      showToast('Finalice la operación actual antes de insertar otra tarjeta.');
      return;
    }
    ui.busy = true;
    touch();
    const result = service.startCardSession(cardId);
    if (!result.ok) {
      ui.busy = false;
      showToast(result.reason);
      return;
    }

    await choreographer.cardInsert(cardId);
    insertedCardId = cardId;

    ui.screen = 'pin';
    ui.pin = '';
    ui.error = null;
    ui.result = null;
    ui.receipt = null;
    ui.endedInfo = null;
    ui.lastDispensed = null;
    ui.flow = null;
    ui.busy = false;
    render();
  }

  function scanFromPhone({ autoGenerateIfMissing = false } = {}) {
    if (ui.busy) {
      return;
    }
    if (ui.screen !== 'welcome') {
      showToast('Finalice la operación actual antes de escanear otro QR.');
      return;
    }
    if (!ui.qr) {
      if (!autoGenerateIfMissing) {
        showToast('Genere primero un QR en el móvil.');
        return;
      }
      const customer = state().customers[0];
      if (!customer) {
        showToast('No hay un cliente disponible para generar el QR.');
        return;
      }
      const issued = service.issueQr(customer.id);
      if (!issued.ok) {
        showToast(issued.reason);
        return;
      }
      ui.qr = { token: issued.token, expiresAt: issued.expiresAt };
      ui.qrExpiredRendered = false;
    }

    const result = service.scanQr(ui.qr.token);
    if (!result.ok) {
      if (/expir|utilizado|reconocido/i.test(result.reason)) {
        ui.qr = null;
        ui.qrExpiredRendered = false;
      }
      showToast(result.reason);
      render();
      return;
    }

    ui.screen = 'pin';
    ui.pin = '';
    ui.error = null;
    ui.result = null;
    ui.receipt = null;
    ui.endedInfo = null;
    ui.lastDispensed = null;
    ui.flow = null;
    touch();
    render();
  }

  function generateQr() {
    const customer = state().customers[0];
    if (!customer) {
      showToast('No hay un cliente disponible para generar el QR.');
      return;
    }
    const result = service.issueQr(customer.id);
    if (!result.ok) {
      showToast(result.reason);
      return;
    }
    ui.qr = { token: result.token, expiresAt: result.expiresAt };
    ui.qrExpiredRendered = false;
    render();
  }

  function runProcessing(action) {
    if (ui.busy) {
      return;
    }
    ui.busy = true;
    ui.screen = 'processing';
    ui.error = null;
    pauseSessionTimeout = true;
    render();
    setTimeout(async () => {
      try {
        await action();
      } catch (error) {
        ui.screen = 'menu';
        ui.error = error.message;
        render();
      } finally {
        ui.busy = false;
        pauseSessionTimeout = false;
        touch();
      }
    }, 480);
  }

  function submitAmount() {
    const amount = Number(ui.amountInput || 0);
    if (!amount) {
      ui.error = 'Ingrese un monto para continuar.';
      render();
      return;
    }
    const flow = ui.flow;
    runProcessing(async () => {
      const result = flow === 'avance' ? service.cashAdvance(amount) : service.withdraw(amount);
      if (result.ok && (result.transaction?.type === 'retiro' || result.transaction?.type === 'avance')) {
        await choreographer.dispense(result.dispensed ?? {});
      }
      handleResult(result);
    });
  }

  function buildResultLines(transaction, result) {
    const lines = [{ label: 'Operación', value: transaction.id }];

    if (transaction.amount > 0) {
      lines.push({ label: 'Monto', value: formatCOP(transaction.amount) });
    }

    if (transaction.status === 'rechazada') {
      lines.push({ label: 'Motivo', value: result.reason ?? transaction.reason ?? 'Rechazada' });
      lines.push({ label: 'Estado', value: 'RECHAZADA' });
      return lines;
    }

    if (transaction.type === 'retiro') {
      lines.push({ label: 'Cuenta', value: transaction.accountMasked ?? '—' });
      lines.push({ label: 'Saldo después', value: formatCOP(transaction.balanceAfter ?? 0) });
      lines.push({ label: 'Billetes', value: formatBills(transaction.dispensed) });
    }

    if (transaction.type === 'deposito') {
      lines.push({ label: 'Cuenta', value: transaction.accountMasked ?? '—' });
      lines.push({ label: 'Saldo después', value: formatCOP(transaction.balanceAfter ?? 0) });
      lines.push({ label: 'Billetes', value: formatBills(transaction.deposited) });
    }

    if (transaction.type === 'avance') {
      lines.push({ label: 'Comisión fija', value: formatCOP(transaction.fixedFee ?? 0) });
      lines.push({ label: 'Comisión 4%', value: formatCOP(transaction.variableFee ?? 0) });
      lines.push({ label: 'Comisión total', value: formatCOP(transaction.commission ?? 0) });
      lines.push({ label: 'Interés mensual', value: formatCOP(transaction.monthlyInterest ?? 0) });
      lines.push({
        label: 'Cupo disponible',
        value: formatCOP(transaction.availableCreditAfter ?? 0),
      });
      lines.push({ label: 'Billetes', value: formatBills(transaction.dispensed) });
    }

    if (transaction.type === 'consulta') {
      lines.push({ label: 'Cuenta', value: transaction.accountMasked ?? '—' });
      lines.push({ label: 'Saldo disponible', value: formatCOP(transaction.balanceAfter ?? 0) });
    }

    lines.push({ label: 'Estado', value: 'APROBADA' });

    return lines;
  }

  function handleResult(result) {
    const transaction = result.transaction;
    if (!transaction) {
      ui.screen = 'menu';
      ui.error = result.reason ?? 'Operación no disponible.';
      render();
      return;
    }

    if (result.ok && (transaction.type === 'retiro' || transaction.type === 'avance')) {
      ui.lastDispensed = result.dispensed ?? null;
    }
    if (result.ok && transaction.type === 'deposito') {
      ui.depositCounts = Object.fromEntries(DENOMINATIONS.map((denomination) => [denomination, 0]));
      ui.lastDispensed = null;
    }

    const isConsultation = transaction.type === 'consulta';
    const title = result.ok
      ? isConsultation
        ? 'Consulta realizada'
        : `${TRANSACTION_LABELS[transaction.type]} aprobado`
      : 'Operación rechazada';

    let note = null;
    if (result.ok && transaction.type === 'avance') {
      note = 'El interés del 2,3% M.V. se causa desde la fecha del avance, sin período de gracia.';
    }
    if (!result.ok && result.transaction) {
      note = 'Puede imprimir el comprobante del rechazo o volver al menú para intentar otra operación.';
    }

    ui.result = {
      ok: result.ok,
      tx: transaction,
      title,
      subtitle: `Comprobante ${transaction.id} · ${shortTime(transaction.at)}`,
      lines: buildResultLines(transaction, result),
      note,
    };
    ui.screen = 'result';
    ui.error = null;
    render();
  }

  function continueAfterResult() {
    if (service.state === 'authenticated') {
      ui.screen = 'menu';
      ui.result = null;
      ui.error = null;
      render();
      return;
    }
    ui.screen = 'ended';
    ui.endedInfo = { reason: 'Operación finalizada.' };
    render();
  }

  async function printReceipt() {
    if (!ui.result?.tx) {
      return;
    }
    ui.busy = true;
    pauseSessionTimeout = true;
    const result = service.printReceipt(ui.result.tx.id);
    if (!result.ok) {
      ui.busy = false;
      pauseSessionTimeout = false;
      showToast(result.reason);
      return;
    }
    await choreographer.receipt();
    pauseSessionTimeout = false;
    ui.busy = false;
    ui.receipt = result.receipt;
    ui.screen = 'receipt';
    render();
  }

  async function finishSession(reasonText = 'Operación finalizada. Retire su tarjeta y su recibo.') {
    if (ui.busy) {
      return;
    }
    ui.busy = true;
    service.endSession('user');
    if (insertedCardId) {
      await choreographer.cardReturn(insertedCardId);
      insertedCardId = null;
    }
    ui.busy = false;
    ui.screen = 'ended';
    ui.endedInfo = { reason: reasonText };
    ui.pin = '';
    render();
  }

  function newSession() {
    service.reset();
    insertedCardId = null;
    resetUi();
    touch();
    render();
  }

  function adjustDeposit(denomination, delta) {
    const current = ui.depositCounts[denomination] ?? 0;
    ui.depositCounts[denomination] = Math.max(0, Math.min(999, current + delta));
    ui.error = null;
    render();
  }

  function submitDeposit() {
    const total = sumDenominations(ui.depositCounts);
    if (total <= 0) {
      ui.error = 'Seleccione al menos un billete para depositar.';
      render();
      return;
    }
    runProcessing(async () => {
      const result = service.deposit(ui.depositCounts);
      if (result.ok && result.transaction?.type === 'deposito') {
        await choreographer.deposit(result.deposited ?? {});
      }
      handleResult(result);
    });
  }

  function queryBalance() {
    runProcessing(() => {
      const result = service.inquiry();
      handleResult(result);
    });
  }

  function handleKey(key) {
    if (ui.busy) {
      return;
    }
    touch();

    if (key === 'back') {
      if (ui.screen === 'pin') {
        ui.pin = ui.pin.slice(0, -1);
      } else if (ui.screen === 'amount') {
        ui.amountInput = ui.amountInput.slice(0, -1);
      }
      ui.error = null;
      render();
      return;
    }

    if (key === 'ok') {
      if (ui.screen === 'pin') {
        submitPin();
      } else if (ui.screen === 'amount') {
        submitAmount();
      }
      return;
    }

    if (!/^\d$/.test(key)) {
      return;
    }

    if (ui.screen === 'pin') {
      if (ui.pin.length >= 4) {
        return;
      }
      ui.pin += key;
      ui.error = null;
      render();
      if (ui.pin.length === 4) {
        setTimeout(() => {
          if (ui.screen === 'pin' && ui.pin.length === 4) {
            submitPin();
          }
        }, 180);
      }
      return;
    }

    if (ui.screen === 'amount') {
      if (ui.amountInput.length >= 7) {
        return;
      }
      ui.amountInput = `${ui.amountInput === '0' ? '' : ui.amountInput}${key}`;
      ui.error = null;
      render();
    }
  }

  function handleAction(action, element) {
    if (action !== 'reset-sim' && ui.busy && action !== 'new-session') {
      return;
    }

    switch (action) {
      case 'insert-card':
        void startCard(element.dataset.cardId);
        break;
      case 'generate-qr':
        generateQr();
        break;
      case 'scan-qr':
        scanFromPhone();
        break;
      case 'menu-withdraw':
        ui.flow = 'retiro';
        ui.amountInput = '';
        ui.error = null;
        ui.screen = 'amount';
        render();
        break;
      case 'menu-advance':
        ui.flow = 'avance';
        ui.amountInput = '';
        ui.error = null;
        ui.screen = 'amount';
        render();
        break;
      case 'menu-deposit':
        ui.flow = 'deposito';
        ui.depositCounts = Object.fromEntries(DENOMINATIONS.map((denomination) => [denomination, 0]));
        ui.error = null;
        ui.screen = 'deposit';
        render();
        break;
      case 'menu-balance':
        queryBalance();
        break;
      case 'menu-finish':
        void finishSession('Sesión finalizada. Retire su tarjeta.');
        break;
      case 'quick-amount':
        ui.amountInput = String(element.dataset.amount);
        ui.error = null;
        render();
        break;
      case 'dep-plus':
        adjustDeposit(Number(element.dataset.denom), 1);
        break;
      case 'dep-minus':
        adjustDeposit(Number(element.dataset.denom), -1);
        break;
      case 'dep-clear':
        ui.depositCounts = Object.fromEntries(DENOMINATIONS.map((denomination) => [denomination, 0]));
        ui.error = null;
        render();
        break;
      case 'dep-confirm':
        submitDeposit();
        break;
      case 'result-print':
        void printReceipt();
        break;
      case 'result-continue':
        continueAfterResult();
        break;
      case 'receipt-print':
        window.print();
        break;
      case 'receipt-finish':
        void finishSession('Operación finalizada. Retire su recibo.');
        break;
      case 'cancel':
        if (ui.screen === 'amount' || ui.screen === 'deposit') {
          ui.screen = 'menu';
          ui.error = null;
          render();
        } else if (ui.screen === 'pin' || ui.screen === 'menu') {
          void finishSession('Operación cancelada por el usuario.');
        }
        break;
      case 'new-session':
        newSession();
        break;
      case 'reset-sim':
        if (typeof onReset === 'function') {
          onReset();
        }
        break;
      case 'toggle-audio':
        ui.audioEnabled = audioEngine.toggle();
        showToast(ui.audioEnabled ? 'Audio activado.' : 'Audio silenciado.');
        render();
        break;
      default:
        break;
    }
  }

  const detachKineticDrag = attachKineticDrag(root, {
    reducedMotion: prefersReduced,
    onActivity: touch,
    onInvalidDrop: invalidDrop,
    onDrop: ({ kind, id }) => {
      if (kind === 'card') {
        void startCard(id);
      } else {
        scanFromPhone({ autoGenerateIfMissing: true });
      }
    },
  });

  root.addEventListener(
    'pointerup',
    (event) => {
      if (choreographer.active) {
        return;
      }
      const keyElement = event.target.closest('[data-key]');
      if (!keyElement || keyElement.disabled) {
        return;
      }
      event.preventDefault();
      touch();
      const key = keyElement.dataset.key;
      handleKey(key);
      lastPointerKey = key;
      lastPointerKeyAt = performance.now();
    },
    { signal: controller.signal },
  );

  root.addEventListener(
    'click',
    (event) => {
      if (choreographer.active) {
        choreographer.skip();
        return;
      }
      const keyElement = event.target.closest('[data-key]');
      if (keyElement) {
        const key = keyElement.dataset.key;
        const now = performance.now();
        if (lastPointerKey === key && now - lastPointerKeyAt < 450) {
          return;
        }
        handleKey(key);
        return;
      }
      const actionElement = event.target.closest('[data-action]');
      if (!actionElement) {
        return;
      }
      touch();
      handleAction(actionElement.dataset.action, actionElement);
    },
    { signal: controller.signal },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (choreographer.active && event.key !== 'Tab') {
        choreographer.skip();
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        if (ui.screen === 'amount' || ui.screen === 'deposit') {
          ui.screen = 'menu';
          ui.error = null;
          render();
        }
        return;
      }
      if (event.key === 'Backspace') {
        handleKey('back');
        return;
      }
      if (event.key === 'Enter') {
        handleKey('ok');
        return;
      }
      if (/^\d$/.test(event.key)) {
        handleKey(event.key);
      }
    },
    { signal: controller.signal },
  );

  tickTimer = setInterval(() => {
    updateClock();

    if (ui.qr && !ui.qrExpiredRendered && Date.now() > ui.qr.expiresAt) {
      ui.qrExpiredRendered = true;
      render();
    }

    if (
      !ui.busy &&
      !pauseSessionTimeout &&
      !choreographer.active &&
      service.state !== 'idle' &&
      service.state !== 'session-ended' &&
      Date.now() - lastActivity > LIMITS.sessionTimeoutMs
    ) {
      service.endSession('timeout');
      ui.screen = 'ended';
      ui.endedInfo = { reason: 'Sesión cerrada automáticamente por inactividad.' };
      render();
    }
  }, 1000);

  render();

  return () => {
    choreographer.skip();
    detachKineticDrag();
    controller.abort();
    clearInterval(tickTimer);
    clearTimeout(toastTimer);
    clearTimeout(invalidTimer);
  };
}
