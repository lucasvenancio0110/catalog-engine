import { animate, stagger } from 'motion';

function reducedMotionRequested() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function revealCards(container) {
  if (reducedMotionRequested()) return;

  const cards = [...container.querySelectorAll('.card')];
  if (!cards.length) return;

  animate(
    cards,
    { opacity: [0, 1], y: [10, 0] },
    { duration: 0.22, delay: stagger(0.018), ease: 'easeOut' }
  );
}

export function revealDialog(dialog) {
  if (reducedMotionRequested()) return;

  const targets = dialog.querySelectorAll('.dialog-gallery, .dialog-copy');
  if (!targets.length) return;

  animate(
    targets,
    { opacity: [0, 1], y: [8, 0] },
    { duration: 0.2, delay: stagger(0.035), ease: 'easeOut' }
  );
}
