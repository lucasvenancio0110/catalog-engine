import {
  Baby,
  ChevronLeft,
  ChevronRight,
  createIcons,
  Flag,
  Footprints,
  Globe,
  History,
  MessageCircle,
  Moon,
  RefreshCw,
  Search,
  Shirt,
  Sun,
  Tag,
  Trophy,
  Users,
  X
} from 'lucide';

const storefrontIcons = {
  Baby,
  ChevronLeft,
  ChevronRight,
  Flag,
  Footprints,
  Globe,
  History,
  MessageCircle,
  Moon,
  RefreshCw,
  Search,
  Shirt,
  Sun,
  Tag,
  Trophy,
  Users,
  X
};

export function hydrateStorefrontIcons(root = document) {
  createIcons({
    root,
    icons: storefrontIcons,
    attrs: {
      'aria-hidden': 'true',
      'stroke-width': 1.8
    }
  });
}
