export const ATM_STATES = {
  IDLE: 'idle',
  AUTHENTICATING: 'authenticating',
  AUTHENTICATED: 'authenticated',
  PROCESSING: 'transaction-processing',
  PRINTING: 'printing-receipt',
  ENDED: 'session-ended',
};

const TRANSITIONS = {
  [ATM_STATES.IDLE]: [ATM_STATES.AUTHENTICATING],
  [ATM_STATES.AUTHENTICATING]: [ATM_STATES.AUTHENTICATED, ATM_STATES.ENDED],
  [ATM_STATES.AUTHENTICATED]: [
    ATM_STATES.PROCESSING,
    ATM_STATES.PRINTING,
    ATM_STATES.ENDED,
  ],
  [ATM_STATES.PROCESSING]: [
    ATM_STATES.AUTHENTICATED,
    ATM_STATES.PRINTING,
    ATM_STATES.ENDED,
  ],
  [ATM_STATES.PRINTING]: [ATM_STATES.ENDED],
  [ATM_STATES.ENDED]: [ATM_STATES.IDLE],
};

export function allowedTransitions(state) {
  return [...(TRANSITIONS[state] ?? [])];
}

export function createStateMachine(initialState = ATM_STATES.IDLE) {
  if (!Object.values(ATM_STATES).includes(initialState)) {
    throw new Error(`Estado inicial inválido: ${initialState}`);
  }

  let state = initialState;
  const history = [state];

  return {
    get state() {
      return state;
    },
    get history() {
      return [...history];
    },
    can(nextState) {
      return allowedTransitions(state).includes(nextState);
    },
    transition(nextState) {
      if (!this.can(nextState)) {
        throw new Error(`Transición inválida de "${state}" a "${nextState}".`);
      }
      state = nextState;
      history.push(state);
      return state;
    },
    reset() {
      state = ATM_STATES.IDLE;
      history.push(state);
      return state;
    },
  };
}
