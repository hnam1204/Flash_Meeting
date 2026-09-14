import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Camera,
  CameraOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleStop,
  CircleUser,
  CircleX,
  ChartLine,
  ChartNoAxesCombined,
  Clock3,
  Copy,
  Download,
  Ellipsis,
  Eye,
  Hash,
  Hand,
  House,
  Info,
  KeyRound,
  LockKeyhole,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  Radio,
  RefreshCw,
  ScreenShare,
  ScreenShareOff,
  Search,
  SearchX,
  Send,
  Share2,
  ShieldCheck,
  Signal,
  Smile,
  Square,
  TriangleAlert,
  UserCog,
  UserPlus,
  UserRound,
  UserRoundX,
  Users,
  Video,
  VideoOff,
  X,
  createIcons
} from 'lucide';

const ICONS = {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Camera,
  CameraOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleStop,
  CircleUser,
  CircleX,
  ChartLine,
  ChartNoAxesCombined,
  Clock3,
  Copy,
  Download,
  Ellipsis,
  Eye,
  Hash,
  Hand,
  House,
  Info,
  KeyRound,
  LockKeyhole,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  Radio,
  RefreshCw,
  ScreenShare,
  ScreenShareOff,
  Search,
  SearchX,
  Send,
  Share2,
  ShieldCheck,
  Signal,
  Smile,
  Square,
  TriangleAlert,
  UserCog,
  UserPlus,
  UserRound,
  UserRoundX,
  Users,
  Video,
  VideoOff,
  X
};

const ICON_ATTRIBUTES = Object.freeze({
  'stroke-width': '1.9',
  focusable: 'false'
});

export function renderIcons(root = document) {
  if (!root?.querySelectorAll) return;
  createIcons({ icons: ICONS, root, attrs: ICON_ATTRIBUTES });
}

export function createIcon(name, { className = '', label = '' } = {}) {
  const element = document.createElement('i');
  element.dataset.lucide = name;
  if (className) element.className = className;
  if (label) element.setAttribute('aria-label', label);
  return element;
}

export function setIcon(target, name, options = {}) {
  if (!target) return;
  target.replaceChildren(createIcon(name, options));
  renderIcons(target);
}
