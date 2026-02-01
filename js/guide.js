// === Guide Tour (post-onboarding) ===

const LS_KEY = 'lezgo_tour_done';
const PADDING = 8;

const TOUR_STEPS = [
  {
    target: null,
    title: 'Bienvenue sur Lezgo.gg !',
    body: 'Tu fais maintenant partie de la communaute ! Voici un tour rapide.',
    position: 'center',
  },
  {
    target: '#nav-profile',
    title: 'Ton profil',
    body: 'Retrouve ton rang, tes stats et lance une analyse de ton gameplay.',
    position: 'bottom',
  },
  {
    target: '#nav-browse',
    title: 'Ta communaute',
    body: 'Decouvre les joueurs de ta communaute, les annonces de groupe et les tournois.',
    position: 'bottom',
  },
  {
    target: '#browse-tournaments',
    title: 'Tournois',
    body: 'Inscris-toi aux tournois organises par ta communaute.',
    position: 'top',
  },
];

let overlay = null;
let backdrop = null;
let tooltip = null;
let currentStep = 0;
let resizeTimer = null;
let previousHighlight = null;

// --- Public API ---

export function startTour() {
  currentStep = 0;
  createOverlay();
  renderStep();
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
}

export function isTourDone() {
  return localStorage.getItem(LS_KEY) === '1';
}

// --- DOM creation ---

function createOverlay() {
  // Clean up any existing tour
  cleanup();

  overlay = document.createElement('div');
  overlay.className = 'guide-overlay';

  backdrop = document.createElement('div');
  backdrop.className = 'guide-backdrop no-target';

  tooltip = document.createElement('div');
  tooltip.className = 'guide-tooltip';

  overlay.appendChild(backdrop);
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);

  // Block clicks on backdrop / overlay (but not tooltip)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === backdrop) {
      e.stopPropagation();
    }
  });
}

// --- Render current step ---

function renderStep() {
  // Skip steps whose target is missing
  const step = resolveStep();
  if (!step) {
    endTour();
    return;
  }

  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;
  const isWelcome = step.target === null;

  // Remove previous highlight
  if (previousHighlight) {
    previousHighlight.classList.remove('guide-target-highlight');
    previousHighlight = null;
  }

  // Target element
  const targetEl = step.target ? document.querySelector(step.target) : null;

  // Add highlight to current target
  if (targetEl) {
    targetEl.classList.add('guide-target-highlight');
    previousHighlight = targetEl;
  }

  // Position backdrop
  positionBackdrop(targetEl);

  // Build tooltip content
  tooltip.className = 'guide-tooltip' + (isWelcome ? ' guide-welcome' : '');
  tooltip.innerHTML = `
    <div class="guide-tooltip-title">${step.title}</div>
    <div class="guide-tooltip-body">${step.body}</div>
    <div class="guide-nav">
      <span class="guide-progress">${currentStep + 1}/${TOUR_STEPS.length}</span>
      <div class="guide-nav-buttons">
        <button class="btn btn-ghost guide-btn-skip">Passer</button>
        ${!isFirst ? '<button class="btn btn-ghost guide-btn-prev">Précédent</button>' : ''}
        <button class="btn btn-primary guide-btn-next">${isLast ? 'Terminer' : 'Suivant'}</button>
      </div>
    </div>
  `;

  // Bind buttons
  tooltip.querySelector('.guide-btn-skip').addEventListener('click', endTour);
  tooltip.querySelector('.guide-btn-prev')?.addEventListener('click', prevStep);
  tooltip.querySelector('.guide-btn-next').addEventListener('click', nextStep);

  // Position tooltip (after DOM update so dimensions are known)
  if (!isWelcome && targetEl) {
    requestAnimationFrame(() => positionTooltip(targetEl, step.position));
  }
}

// Resolve step — skip if target missing (except null target = welcome)
function resolveStep() {
  while (currentStep < TOUR_STEPS.length) {
    const step = TOUR_STEPS[currentStep];
    if (step.target === null) return step; // welcome step
    if (document.querySelector(step.target)) return step;
    currentStep++;
  }
  return null;
}

// --- Positioning ---

function positionBackdrop(targetEl) {
  if (!targetEl) {
    backdrop.classList.add('no-target');
    backdrop.style.top = '50%';
    backdrop.style.left = '50%';
    backdrop.style.width = '0';
    backdrop.style.height = '0';
    return;
  }

  backdrop.classList.remove('no-target');
  const rect = targetEl.getBoundingClientRect();
  backdrop.style.top = (rect.top - PADDING) + 'px';
  backdrop.style.left = (rect.left - PADDING) + 'px';
  backdrop.style.width = (rect.width + PADDING * 2) + 'px';
  backdrop.style.height = (rect.height + PADDING * 2) + 'px';
}

function positionTooltip(targetEl, position) {
  const rect = targetEl.getBoundingClientRect();
  const ttRect = tooltip.getBoundingClientRect();
  const gap = 14; // space between target and tooltip

  let top, left;

  // Remove any existing arrow
  const oldArrow = tooltip.querySelector('.guide-arrow');
  if (oldArrow) oldArrow.remove();

  const arrow = document.createElement('div');
  arrow.className = 'guide-arrow';

  if (position === 'bottom') {
    // Tooltip below target
    top = rect.bottom + gap;
    left = rect.left + rect.width / 2 - ttRect.width / 2;
    arrow.classList.add('arrow-top');
  } else {
    // Tooltip above target (position === 'top')
    top = rect.top - ttRect.height - gap;
    left = rect.left + rect.width / 2 - ttRect.width / 2;
    arrow.classList.add('arrow-bottom');
  }

  // Clamp horizontal to viewport
  const margin = 12;
  left = Math.max(margin, Math.min(left, window.innerWidth - ttRect.width - margin));

  tooltip.style.top = top + 'px';
  tooltip.style.left = left + 'px';

  // Position arrow relative to tooltip
  const arrowLeft = (rect.left + rect.width / 2) - left - 6; // 6 = half arrow width
  arrow.style.left = Math.max(12, Math.min(arrowLeft, ttRect.width - 24)) + 'px';

  tooltip.appendChild(arrow);
}

// --- Navigation ---

function nextStep() {
  currentStep++;
  if (currentStep >= TOUR_STEPS.length) {
    endTour();
  } else {
    renderStep();
  }
}

function prevStep() {
  if (currentStep > 0) {
    currentStep--;
    renderStep();
  }
}

function endTour() {
  localStorage.setItem(LS_KEY, '1');

  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', onResize);

  if (previousHighlight) {
    previousHighlight.classList.remove('guide-target-highlight');
    previousHighlight = null;
  }

  if (overlay) {
    overlay.classList.add('guide-fade-out');
    overlay.addEventListener('transitionend', () => {
      overlay.remove();
      overlay = null;
      backdrop = null;
      tooltip = null;
    }, { once: true });
  }
}

function cleanup() {
  if (overlay) {
    overlay.remove();
    overlay = null;
    backdrop = null;
    tooltip = null;
  }
  if (previousHighlight) {
    previousHighlight.classList.remove('guide-target-highlight');
    previousHighlight = null;
  }
}

// --- Event handlers ---

function onKeyDown(e) {
  if (e.key === 'Escape') {
    endTour();
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    nextStep();
  } else if (e.key === 'ArrowLeft') {
    prevStep();
  }
}

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!overlay) return;

    const step = TOUR_STEPS[currentStep];
    if (!step) return;

    const targetEl = step.target ? document.querySelector(step.target) : null;
    positionBackdrop(targetEl);
    if (targetEl && step.position !== 'center') {
      positionTooltip(targetEl, step.position);
    }
  }, 100);
}
