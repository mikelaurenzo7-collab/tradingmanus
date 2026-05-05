/**
 * Micro-interaction utilities for delightful UI feedback.
 * All effects respect `prefers-reduced-motion` and auto-cleanup.
 */

/**
 * Check if reduced motion is preferred.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Generate a random color from the theme palette.
 */
function getRandomColor(): string {
  const colors = [
    'oklch(0.88 0.35 280)', // Electric violet
    'oklch(0.85 0.38 15)',  // Coral pink
    'oklch(0.82 0.36 200)', // Cyan
    'oklch(0.80 0.35 140)', // Lime
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Trigger a burst of confetti particles from the origin element or viewport center.
 * Particles auto-cleanup after animation completes.
 *
 * @param originElement - Optional element to burst from; defaults to viewport center
 */
export function triggerConfetti(originElement?: HTMLElement): void {
  if (prefersReducedMotion()) return;

  const particleCount = 30;
  const particles: HTMLDivElement[] = [];

  // Determine origin position
  let originX: number;
  let originY: number;

  if (originElement) {
    const rect = originElement.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
  } else {
    originX = window.innerWidth / 2;
    originY = window.innerHeight / 2;
  }

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'confetti-particle';
    particle.style.left = `${originX}px`;
    particle.style.top = `${originY}px`;
    particle.style.backgroundColor = getRandomColor();

    // Random velocity for spread
    const angle = (Math.random() * 360 * Math.PI) / 180;
    const velocity = 50 + Math.random() * 100;
    const offsetX = Math.cos(angle) * velocity;
    const offsetY = Math.sin(angle) * velocity;

    particle.style.setProperty('--offset-x', `${offsetX}px`);
    particle.style.setProperty('--offset-y', `${offsetY}px`);

    // Random rotation and duration for variety
    const rotation = Math.random() * 360;
    const duration = 1.5 + Math.random() * 1;
    particle.style.transform = `rotate(${rotation}deg)`;
    particle.style.animationDuration = `${duration}s`;

    document.body.appendChild(particle);
    particles.push(particle);

    // Auto-cleanup after animation
    setTimeout(() => {
      particle.remove();
    }, duration * 1000);
  }
}

/**
 * Shake an element with configurable intensity.
 * Auto-removes the shake class after animation completes.
 *
 * @param el - Element to shake
 * @param intensity - Shake intensity: 'subtle', 'normal', or 'strong' (default: 'normal')
 */
export function shakeElement(
  el: HTMLElement,
  intensity: 'subtle' | 'normal' | 'strong' = 'normal'
): void {
  if (prefersReducedMotion()) return;

  const className = `shake-${intensity}`;
  el.classList.add(className);

  // Duration based on intensity
  const durations = {
    subtle: 400,
    normal: 500,
    strong: 600,
  };

  setTimeout(() => {
    el.classList.remove(className);
  }, durations[intensity]);
}

/**
 * Create a ripple effect at the click position on the target element.
 * Auto-cleans up the ripple DOM node after animation.
 *
 * @param event - Mouse event with target and position information
 */
export function rippleEffect(event: MouseEvent | React.MouseEvent): void {
  if (prefersReducedMotion()) return;

  const target = event.currentTarget as HTMLElement;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;

  const ripple = document.createElement('span');
  ripple.className = 'ripple-effect';
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  // Ensure target is positioned
  const position = window.getComputedStyle(target).position;
  if (position === 'static') {
    target.style.position = 'relative';
  }

  target.appendChild(ripple);

  // Auto-cleanup after animation (600ms)
  setTimeout(() => {
    ripple.remove();
  }, 600);
}

/**
 * Apply a single pulse glow effect to an element.
 * Auto-removes the pulse class after animation completes.
 *
 * @param el - Element to pulse
 * @param color - Optional color for the pulse glow (defaults to primary)
 */
export function pulseElement(el: HTMLElement, color?: string): void {
  if (prefersReducedMotion()) return;

  el.classList.add('pulse-single');

  // Set custom color if provided
  if (color) {
    el.style.setProperty('color', color);
  }

  // Auto-cleanup after animation (600ms)
  setTimeout(() => {
    el.classList.remove('pulse-single');
    if (color) {
      el.style.removeProperty('color');
    }
  }, 600);
}
