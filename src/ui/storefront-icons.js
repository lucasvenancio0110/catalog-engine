import {
  ArrowRight,
  ArrowUpRight,
  Baby,
  ChevronLeft,
  ChevronRight,
  Compass,
  createIcons,
  Flag,
  Footprints,
  Globe,
  Grid2X2,
  History,
  Home,
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
  ArrowRight,
  ArrowUpRight,
  Baby,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flag,
  Footprints,
  Globe,
  Grid2X2,
  History,
  Home,
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
