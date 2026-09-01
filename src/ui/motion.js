import { animate, stagger } from 'motion';

export const MOTION_DURATION = Object.freeze({
  press: 0.11,
  fast: 0.14,
  standard: 0.22,
  layer: 0.32,
  page: 0.4
});

export const MOTION_EASE = Object.freeze({
  standard: 'easeOut',
  emphasized: [0.22, 1, 0.36, 1]
});

export function reducedMotionRequested() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function runViewTransition(update) {
  if (typeof update !== 'function') {
    throw new TypeError('runViewTransition requires an update function');
  }

  if (
    reducedMotionRequested() ||
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function'
  ) {
    update();
    return null;
  }

  return document.startViewTransition(update);
}

export function bindPressFeedback(target, { pressedScale = 0.97 } = {}) {
  if (!target || reducedMotionRequested()) return () => {};

  let pressed = false;

  const press = () => {
    if (pressed) return;
    pressed = true;
    animate(
      target,
      { scale: pressedScale },
      { duration: MOTION_DURATION.press, ease: MOTION_EASE.standard }
    );
  };

  const release = () => {
    if (!pressed) return;
    pressed = false;
    animate(
      target,
      { scale: 1 },
      { duration: MOTION_DURATION.fast, ease: MOTION_EASE.emphasized }
    );
  };

  const keyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') press();
  };

  const keyUp = (event) => {
    if (event.key === 'Enter' || event.key === ' ') release();
  };

  target.addEventListener('pointerdown', press);
  target.addEventListener('pointerup', release);
  target.addEventListener('pointercancel', release);
  target.addEventListener('pointerleave', release);
  target.addEventListener('keydown', keyDown);
  target.addEventListener('keyup', keyUp);
  target.addEventListener('blur', release);

  return () => {
    release();
    target.removeEventListener('pointerdown', press);
    target.removeEventListener('pointerup', release);
    target.removeEventListener('pointercancel', release);
    target.removeEventListener('pointerleave', release);
    target.removeEventListener('keydown', keyDown);
    target.removeEventListener('keyup', keyUp);
    target.removeEventListener('blur', release);
  };
}

export function revealCards(container) {
  if (reducedMotionRequested()) return;

  const cards = [...container.querySelectorAll('.card')];
  if (!cards.length) return;

  animate(
    cards,
    { opacity: [0, 1], y: [10, 0] },
    {
      duration: MOTION_DURATION.standard,
      delay: stagger(0.018),
      ease: MOTION_EASE.standard
    }
  );
}

export function revealDialog(dialog) {
  if (reducedMotionRequested()) return;

  const targets = dialog.querySelectorAll('.dialog-gallery, .dialog-copy');
  if (!targets.length) return;

  animate(
    targets,
    { opacity: [0, 1], y: [8, 0] },
    {
      duration: MOTION_DURATION.standard,
      delay: stagger(0.035),
      ease: MOTION_EASE.standard
    }
  );
}
