function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function center(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getInvalidMessage(kind, zoneType) {
  if (!zoneType) {
    return 'Suelta la tarjeta en la ranura o el móvil en el lector QR.';
  }
  if (kind === 'card' && zoneType !== 'card') {
    return 'La tarjeta va en la ranura, no en el lector QR.';
  }
  if (kind === 'phone' && zoneType !== 'phone') {
    return 'El móvil va en el lector QR, no en la ranura de tarjeta.';
  }
  return 'Destino no válido para ese objeto.';
}

export function attachKineticDrag(root, {
  onDrop,
  onInvalidDrop,
  onActivity,
  reducedMotion = () => false,
} = {}) {
  let drag = null;
  let raf = 0;
  const events = new AbortController();
  const { signal } = events;

  const setStyles = (element, styles) => {
    Object.entries(styles).forEach(([key, value]) => {
      element.style[key] = value;
    });
  };

  function cleanup() {
    if (!drag) {
      return;
    }
    cancelAnimationFrame(raf);
    root.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));

    const { element, ghostParent, original, pointerId } = drag;
    try {
      if (element.hasPointerCapture?.(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // noop
    }

    element.classList.remove('is-kinetic-dragging');
    setStyles(element, {
      position: '',
      left: '',
      top: '',
      width: '',
      height: '',
      zIndex: '',
      pointerEvents: '',
      transform: '',
      transition: '',
      willChange: '',
      touchAction: '',
    });
    if (ghostParent && original && ghostParent !== original) {
      original.append(element);
    }
    drag = null;
  }

  function renderFrame() {
    if (!drag) {
      return;
    }

    const easing = reducedMotion() ? 1 : drag.mass;
    drag.x += (drag.targetX - drag.x) * easing;
    drag.y += (drag.targetY - drag.y) * easing;

    drag.velocityX = drag.targetX - drag.x;
    drag.velocityY = drag.targetY - drag.y;

    const rotate = reducedMotion()
      ? 0
      : Math.max(-9, Math.min(9, (drag.velocityX + drag.velocityY * 0.35) * 0.08 * drag.rotateFactor));
    const tilt = reducedMotion() ? 0 : Math.max(-6, Math.min(6, drag.velocityY * -0.06 * drag.rotateFactor));

    drag.element.style.transform = `translate3d(${drag.x}px, ${drag.y}px, 0) rotateZ(${rotate}deg) rotateX(${tilt}deg)`;
    raf = requestAnimationFrame(renderFrame);
  }

  async function animateTo(element, from, to, { ms = 260, easing = 'cubic-bezier(.22,.8,.24,1)' } = {}) {
    if (reducedMotion()) {
      element.style.transform = `translate3d(${to.x}px, ${to.y}px, 0)`;
      return;
    }

    return new Promise((resolve) => {
      const animation = element.animate(
        [
          { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
          { transform: `translate3d(${to.x}px, ${to.y}px, 0)` },
        ],
        { duration: ms, easing, fill: 'forwards' },
      );
      animation.addEventListener('finish', resolve, { once: true });
    });
  }

  function handlePointerDown(event) {
    if (drag) {
      return;
    }
    if (event.button !== 0 && event.pointerType !== 'touch') {
      return;
    }
    if (event.target.closest('button, input, textarea, select')) {
      return;
    }
    const draggable = event.target.closest('[data-draggable-kind]');
    if (!draggable) {
      return;
    }

    const kind = draggable.dataset.draggableKind;
    const id = draggable.dataset.cardId ?? draggable.dataset.draggableId ?? null;
    const rect = draggable.getBoundingClientRect();
    const parent = draggable.parentElement;

    event.preventDefault();
    onActivity?.();

    drag = {
      kind,
      id,
      element: draggable,
      original: parent,
      ghostParent: document.body,
      startRect: rect,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      x: rect.left,
      y: rect.top,
      targetX: rect.left,
      targetY: rect.top,
      mass: kind === 'phone' ? 0.16 : 0.28,
      rotateFactor: kind === 'phone' ? 0.7 : 1,
      pointerId: event.pointerId,
    };

    draggable.classList.add('is-kinetic-dragging');
    setStyles(draggable, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      zIndex: '1000',
      pointerEvents: 'none',
      transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
      transition: 'none',
      willChange: 'transform',
      touchAction: 'none',
    });
    document.body.append(draggable);
    try {
      draggable.setPointerCapture?.(event.pointerId);
    } catch {
      // noop
    }

    raf = requestAnimationFrame(renderFrame);
  }

  function handlePointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    onActivity?.();
    drag.targetX = event.clientX - drag.offsetX;
    drag.targetY = event.clientY - drag.offsetY;

    const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-drop]');
    root.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    if (zone) {
      zone.classList.add('drag-over');
    }
  }

  async function handlePointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    onActivity?.();
    cancelAnimationFrame(raf);

    root.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));

    const pointerZone = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest?.('[data-drop]');

    const rect = drag.element.getBoundingClientRect();
    const dragCenter = center(rect);
    const zones = Array.from(root.querySelectorAll('[data-drop]'));
    const candidates = zones.map((zone) => ({
      zone,
      type: zone.dataset.drop,
      rect: zone.getBoundingClientRect(),
    }));
    const nearest = candidates
      .map((item) => ({ ...item, d: distance(dragCenter, center(item.rect)) }))
      .sort((a, b) => a.d - b.d)[0] ?? null;

    const threshold = drag.kind === 'phone' ? 260 : 180;
    const canSnapByPointer = Boolean(pointerZone && pointerZone.dataset.drop === drag.kind);
    const canSnapByDistance = Boolean(nearest && nearest.type === drag.kind && nearest.d <= threshold);
    const canSnap = canSnapByPointer || canSnapByDistance;
    const from = { x: drag.x, y: drag.y };

    if (canSnap) {
      const targetZone = pointerZone?.dataset?.drop === drag.kind
        ? {
            rect: pointerZone.getBoundingClientRect(),
            type: pointerZone.dataset.drop,
          }
        : nearest;

      const zoneCenter = center(targetZone.rect);
      const to = {
        x: zoneCenter.x - rect.width / 2,
        y: zoneCenter.y - rect.height / 2,
      };
      await animateTo(drag.element, from, to, {
        ms: reducedMotion() ? 100 : 220,
        easing: 'cubic-bezier(.18,.78,.3,1)',
      });

      const { kind, id } = drag;
      cleanup();
      onDrop?.({ kind, id, zoneType: targetZone.type });
      return;
    }

    const fallback = {
      x: drag.startRect.left,
      y: drag.startRect.top,
    };
    await animateTo(drag.element, from, fallback, {
      ms: reducedMotion() ? 120 : 300,
      easing: 'cubic-bezier(.2,.8,.22,1)',
    });

    const message = getInvalidMessage(drag.kind, nearest?.type);
    cleanup();
    onInvalidDrop?.(message);
  }

  function handlePointerCancel(event) {
    if (!drag || (event.pointerId != null && drag.pointerId !== event.pointerId)) {
      return;
    }
    cleanup();
  }

  root.addEventListener('pointerdown', handlePointerDown, { passive: false, signal });
  window.addEventListener('pointermove', handlePointerMove, { passive: true, signal });
  window.addEventListener('pointerup', handlePointerUp, { passive: true, signal });
  window.addEventListener('pointercancel', handlePointerCancel, { passive: true, signal });

  return () => {
    cleanup();
    events.abort();
  };
}
