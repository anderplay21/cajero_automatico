import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATM_STATES,
  allowedTransitions,
  createStateMachine,
} from '../src/domain/state-machine.js';

test('la máquina de estados permite el flujo completo de una sesión', () => {
  const machine = createStateMachine();
  assert.equal(machine.state, ATM_STATES.IDLE);

  machine.transition(ATM_STATES.AUTHENTICATING);
  machine.transition(ATM_STATES.AUTHENTICATED);
  machine.transition(ATM_STATES.PROCESSING);
  machine.transition(ATM_STATES.AUTHENTICATED);
  machine.transition(ATM_STATES.PRINTING);
  machine.transition(ATM_STATES.ENDED);
  machine.transition(ATM_STATES.IDLE);

  assert.deepEqual(machine.history, [
    ATM_STATES.IDLE,
    ATM_STATES.AUTHENTICATING,
    ATM_STATES.AUTHENTICATED,
    ATM_STATES.PROCESSING,
    ATM_STATES.AUTHENTICATED,
    ATM_STATES.PRINTING,
    ATM_STATES.ENDED,
    ATM_STATES.IDLE,
  ]);
});

test('la máquina de estados rechaza transiciones inválidas', () => {
  const machine = createStateMachine();
  assert.throws(
    () => machine.transition(ATM_STATES.AUTHENTICATED),
    /Transición inválida/,
  );
  assert.equal(machine.state, ATM_STATES.IDLE);
});

test('cada estado declara sus transiciones permitidas', () => {
  assert.deepEqual(allowedTransitions(ATM_STATES.IDLE), [ATM_STATES.AUTHENTICATING]);
  assert.deepEqual(allowedTransitions(ATM_STATES.PRINTING), [ATM_STATES.ENDED]);
  assert.deepEqual(allowedTransitions(ATM_STATES.ENDED), [ATM_STATES.IDLE]);
});
