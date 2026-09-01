const MOBILE_QUERY = '(max-width: 47.99rem)';
const KEYBOARD_DELTA_PX = 140;

const SECTION_NAV_KEYS = new Map([
  ['inicio', 'home'],
  ['explorar', 'explore'],
  ['catalogo', 'products']
]);

export function navKeyForSectionId(sectionId) {
  return SECTION_NAV_KEYS.get(sectionId) || 'home';
}

export function isVirtualKeyboardOpen({ layoutHeight, visualHeight, isMobile }) {
  if (!isMobile) return false;
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(visualHeight)) return false;
  return layoutHeight - visualHeight > KEYBOARD_DELTA_PX;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function initMobileShell() {
  const body = document.body;
  const root = document.documentElement;
  const dock = document.querySelector('.mobile-dock');
  const searchDialog = document.querySelector('#searchDialog');
  const searchDialogClose = document.querySelector('#searchDialogClose');
  const searchForm = document.querySelector('#searchForm');
  const searchInput = document.querySelector('#searchInput');
  const navItems = [...document.querySelectorAll('.mobile-dock [data-mobile-nav]')];
  const searchOpeners = [...document.querySelectorAll('[data-open-search]')];
  const sections = [...SECTION_NAV_KEYS.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if (!body?.classList.contains('ce-storefront') || !dock || !navItems.length) return;

  const mobileMedia = window.matchMedia(MOBILE_QUERY);
  let currentSection = navKeyForSectionId(window.location.hash.replace('#', ''));
  let searchHasFocus = false;
  let searchModeOpen = false;
  let lastSearchTrigger = null;
  let scrollFrame = 0;

  function setActiveNav(key) {
    for (const item of navItems) {
      const active = item.dataset.mobileNav === key;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'location');
      else item.removeAttribute('aria-current');
    }
  }

  function sectionAtReadingLine() {
    const readingLine = Math.max(96, window.innerHeight * 0.28);
    let candidate = sections[0];
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= readingLine) candidate = section;
      if (rect.top > readingLine) break;
    }
    return navKeyForSectionId(candidate?.id || 'inicio');
  }

  function syncSectionFromLayout() {
    currentSection = sectionAtReadingLine();
    if (!searchHasFocus && !searchModeOpen) setActiveNav(currentSection);
  }

  function syncScrollState() {
    scrollFrame = 0;
    body.classList.toggle('is-shell-scrolled', window.scrollY > 12);
  }

  function scheduleScrollState() {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(syncScrollState);
  }

  function syncVisualViewport() {
    const viewport = window.visualViewport;
    const visualHeight = viewport?.height || window.innerHeight;
    const offsetTop = viewport?.offsetTop || 0;
    root.style.setProperty('--ce-visual-viewport-height', `${Math.round(visualHeight)}px`);
    root.style.setProperty('--ce-visual-viewport-offset-top', `${Math.round(offsetTop)}px`);
    body.classList.toggle(
      'is-keyboard-open',
      isVirtualKeyboardOpen({
        layoutHeight: window.innerHeight,
        visualHeight,
        isMobile: mobileMedia.matches
      })
    );
  }

  function focusSearchInput() {
    window.requestAnimationFrame(() => {
      searchInput?.focus({ preventScroll: true });
      const end = searchInput?.value?.length || 0;
      searchInput?.setSelectionRange?.(end, end);
    });
  }

  function openSearch(trigger) {
    if (!searchDialog || !searchInput) return;
    lastSearchTrigger = trigger || document.activeElement;
    searchModeOpen = true;
    body.classList.add('is-search-open');
    setActiveNav('search');

    if (!searchDialog.open) {
      if (typeof searchDialog.showModal === 'function') searchDialog.showModal();
      else searchDialog.setAttribute('open', '');
    }

    focusSearchInput();
  }

  function closeSearch({ restoreFocus = true } = {}) {
    if (!searchDialog) return;
    searchModeOpen = false;
    body.classList.remove('is-search-open');

    if (searchDialog.open) {
      if (typeof searchDialog.close === 'function') searchDialog.close();
      else searchDialog.removeAttribute('open');
    }

    searchHasFocus = false;
    syncSectionFromLayout();
    if (restoreFocus && lastSearchTrigger instanceof HTMLElement) {
      lastSearchTrigger.focus({ preventScroll: true });
    }
  }

  const sectionObserver =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            const visible = entries
              .filter((entry) => entry.isIntersecting)
              .sort(
                (a, b) =>
                  Math.abs(a.boundingClientRect.top - window.innerHeight * 0.22) -
                  Math.abs(b.boundingClientRect.top - window.innerHeight * 0.22)
              );
            if (!visible.length) return;
            currentSection = navKeyForSectionId(visible[0].target.id);
            if (!searchHasFocus && !searchModeOpen) setActiveNav(currentSection);
          },
          { rootMargin: '-18% 0px -68% 0px', threshold: 0 }
        )
      : null;

  sections.forEach((section) => sectionObserver?.observe(section));

  searchForm?.addEventListener('focusin', () => {
    searchHasFocus = true;
    setActiveNav('search');
  });

  searchForm?.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (searchForm.contains(document.activeElement)) return;
      searchHasFocus = false;
      if (!searchModeOpen) syncSectionFromLayout();
    }, 0);
  });

  searchForm?.addEventListener('submit', () => {
    window.setTimeout(() => closeSearch({ restoreFocus: false }), 0);
  });

  for (const opener of searchOpeners) {
    if (opener.closest('.mobile-dock')) continue;
    opener.addEventListener('click', () => openSearch(opener));
  }

  searchDialogClose?.addEventListener('click', () => closeSearch());
  searchDialog?.addEventListener('click', (event) => {
    if (event.target === searchDialog) closeSearch();
  });
  searchDialog?.addEventListener('close', () => {
    searchModeOpen = false;
    searchHasFocus = false;
    body.classList.remove('is-search-open');
    syncSectionFromLayout();
  });

  for (const item of navItems) {
    item.addEventListener('click', (event) => {
      const key = item.dataset.mobileNav;
      if (key === 'search') {
        event.preventDefault();
        openSearch(item);
        return;
      }

      searchHasFocus = false;
      searchModeOpen = false;
      setActiveNav(key);
    });
  }

  window.addEventListener('scroll', scheduleScrollState, { passive: true });
  window.addEventListener('resize', () => {
    syncVisualViewport();
    syncSectionFromLayout();
  });
  window.addEventListener('hashchange', syncSectionFromLayout);
  mobileMedia.addEventListener?.('change', syncVisualViewport);
  window.visualViewport?.addEventListener('resize', syncVisualViewport);
  window.visualViewport?.addEventListener('scroll', syncVisualViewport);

  syncScrollState();
  syncVisualViewport();
  syncSectionFromLayout();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initMobileShell();
}
