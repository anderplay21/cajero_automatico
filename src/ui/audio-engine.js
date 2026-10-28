const STORAGE_KEY = 'tecbank-atm-audio-enabled';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createNoiseBuffer(context, seconds = 0.12) {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

function resolveStorage(storage) {
  const fallback = createMemoryStorage();
  try {
    const candidate = storage ?? window.sessionStorage;
    const probe = '__tecbank_audio_probe__';
    candidate.setItem(probe, '1');
    candidate.getItem(probe);
    candidate.removeItem?.(probe);
    return candidate;
  } catch {
    return fallback;
  }
}

export function createAudioEngine({ storage } = {}) {
  const safeStorage = resolveStorage(storage);
  let enabled = safeStorage.getItem(STORAGE_KEY) === '1';
  let context = null;

  function persist() {
    safeStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  }

  function ensureContext() {
    if (!enabled) {
      return null;
    }
    try {
      if (!context) {
        context = new window.AudioContext();
      }
      if (context.state === 'suspended') {
        void context.resume();
      }
      return context;
    } catch {
      return null;
    }
  }

  function now(ctx) {
    return ctx.currentTime + 0.001;
  }

  function playClick() {
    const ctx = ensureContext();
    if (!ctx) {
      return;
    }
    const at = now(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, at);
    osc.frequency.exponentialRampToValueAtTime(420, at + 0.05);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.08, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.08);
  }

  function playServo(durationMs = 420) {
    const ctx = ensureContext();
    if (!ctx) {
      return () => {};
    }

    const at = now(ctx);
    const end = at + clamp(durationMs / 1000, 0.08, 1.4);
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, Math.max(0.08, end - at));

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(180, at);
    filter.frequency.linearRampToValueAtTime(520, end);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.09, at + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(at);
    noise.stop(end + 0.02);

    return () => {
      try {
        noise.stop();
      } catch {
        // noop
      }
    };
  }

  function playPrinter(durationMs = 900) {
    const ctx = ensureContext();
    if (!ctx) {
      return () => {};
    }

    const at = now(ctx);
    const end = at + clamp(durationMs / 1000, 0.12, 2.8);

    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, Math.max(0.2, end - at + 0.08));

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 900;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.06, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(132, at);
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(14, at);
    lfoGain.gain.setValueAtTime(24, at);
    lfo.connect(lfoGain).connect(osc.frequency);

    osc.connect(gain).connect(ctx.destination);
    noise.connect(noiseFilter).connect(gain);

    osc.start(at);
    lfo.start(at);
    noise.start(at);
    osc.stop(end + 0.02);
    lfo.stop(end + 0.02);
    noise.stop(end + 0.02);

    return () => {
      try {
        osc.stop();
        lfo.stop();
        noise.stop();
      } catch {
        // noop
      }
    };
  }

  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(value) {
      enabled = Boolean(value);
      persist();
      if (enabled) {
        ensureContext();
      }
      return enabled;
    },
    toggle() {
      return this.setEnabled(!enabled);
    },
    playClick,
    playServo,
    playPrinter,
  };
}
