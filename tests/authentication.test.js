import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtmService } from '../src/domain/atm-service.js';
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
  assert.equal(service.startCardSession('card-debit-ana').ok, true);
  assert.equal(service.submitPin('1234').ok, true);
  assert.equal(service.state, ATM_STATES.AUTHENTICATED);
}

test('autentica con tarjeta débito y PIN correcto', () => {
  const { service } = setup();
  const start = service.startCardSession('card-debit-ana');

  assert.equal(start.ok, true);
  assert.equal(start.requiresPin, true);
  assert.equal(service.state, ATM_STATES.AUTHENTICATING);

  const result = service.submitPin('1234');
  assert.equal(result.ok, true);
  assert.equal(result.card.kind, 'debit');
  assert.equal(service.state, ATM_STATES.AUTHENTICATED);
});

test('informa intentos restantes y bloquea tras 3 PIN incorrectos', () => {
  const { service } = setup();
  service.startCardSession('card-debit-ana');

  const first = service.submitPin('0000');
  assert.equal(first.ok, false);
  assert.equal(first.attemptsLeft, 2);

  const second = service.submitPin('1111');
  assert.equal(second.ok, false);
  assert.equal(second.attemptsLeft, 1);

  const third = service.submitPin('2222');
  assert.equal(third.ok, false);
  assert.equal(third.blocked, true);
  assert.equal(service.state, ATM_STATES.ENDED);

  service.reset();
  const blocked = service.startCardSession('card-debit-ana');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /bloqueada/i);
});

test('autentica sin tarjeta con QR vigente y PIN', () => {
  const { service } = setup();
  const qr = service.issueQr('cus-ana');

  assert.equal(qr.ok, true);
  assert.equal(service.scanQr(qr.token).ok, true);
  assert.equal(service.state, ATM_STATES.AUTHENTICATING);

  const result = service.submitPin('1234');
  assert.equal(result.ok, true);
  assert.equal(result.session.channel, 'qr');
  assert.equal(service.state, ATM_STATES.AUTHENTICATED);
});

test('rechaza QR expirado y QR ya utilizado', () => {
  const { service, advance } = setup();
  const expired = service.issueQr('cus-ana');
  advance(46_000);

  const expiredResult = service.scanQr(expired.token);
  assert.equal(expiredResult.ok, false);
  assert.match(expiredResult.reason, /expiró/i);

  const fresh = service.issueQr('cus-ana');
  assert.equal(service.scanQr(fresh.token).ok, true);
  service.submitPin('1234');
  service.endSession('user');
  service.reset();

  const reused = service.scanQr(fresh.token);
  assert.equal(reused.ok, false);
  assert.match(reused.reason, /ya fue utilizado/i);
});

test('no permite iniciar una segunda sesión con otra tarjeta', () => {
  const { service } = setup();
  assert.equal(service.startCardSession('card-debit-ana').ok, true);
  const second = service.startCardSession('card-credit-ana');
  assert.equal(second.ok, false);
  assert.match(second.reason, /Finalice la sesión/i);
});
