import {
  ArrowRight,
  CreditCard,
  createIcons,
  Globe,
  LayoutGrid,
  Palette,
  ShieldCheck,
  Store,
  UserRound
} from 'lucide';

const portalIcons = {
  ArrowRight,
  CreditCard,
  Globe,
  LayoutGrid,
  Palette,
  ShieldCheck,
  Store,
  UserRound
};

export function hydratePortalIcons(root = document) {
  createIcons({
    root,
    icons: portalIcons,
    attrs: {
      'aria-hidden': 'true',
      'stroke-width': 1.8
    }
  });
}
