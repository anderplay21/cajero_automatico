export function createQrStore({ clock = () => Date.now(), ttlMs = 45_000 } = {}) {
  const tokens = new Map();
  let counter = 0;

  function issue(customerId) {
    counter += 1;
    const token = `ATMQR-${clock().toString(36).toUpperCase()}-${counter.toString(36).toUpperCase()}`;
    const record = {
      token,
      customerId,
      expiresAt: clock() + ttlMs,
      used: false,
    };
    tokens.set(token, record);
    return { ...record };
  }

  function validate(token) {
    const record = tokens.get(token);
    if (!record) {
      return { ok: false, reason: 'QR no reconocido por el ATM.' };
    }
    if (record.used) {
      return { ok: false, reason: 'Este QR ya fue utilizado. Genere uno nuevo en el móvil.' };
    }
    if (clock() > record.expiresAt) {
      return { ok: false, reason: 'El QR expiró. Genere uno nuevo en el móvil.' };
    }
    return { ok: true, ...record };
  }

  function consume(token) {
    const result = validate(token);
    if (!result.ok) {
      return result;
    }
    tokens.get(token).used = true;
    return result;
  }

  return { issue, validate, consume };
}
