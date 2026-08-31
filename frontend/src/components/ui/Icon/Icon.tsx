import type { TIconTypes } from '@/types';
import { cn } from '@/utils';
import { AlertTriangle, Camera, Check, CheckCircle, ChevronDown, Copy, Eye, EyeOff, FastForward, File, Forward, Globe, Info, Maximize, Megaphone, Menu, MessageCircle, Pause, Pencil, Phone, Pin, Play, Reply, Rewind, Search, Settings, Trash2, UserPlus, Users, Video, Volume2, VolumeX, X, type LucideIcon, type LucideProps } from 'lucide-react';

const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-6', xl: 'size-8' } as const;

interface Props extends Omit<LucideProps, 'size' | 'ref'> {
  name: TIconTypes;
  size?: keyof typeof sizes;
}

const iconsConfig: Record<TIconTypes, LucideIcon> = {
  burger: Menu,
  camera: Camera,
  channel: Megaphone,
  chat: MessageCircle,
  check: Check,
  chevronDown: ChevronDown,
  checkCircle: CheckCircle,
  copy: Copy,
  cross: X,
  info: Info,
  edit: Pencil,
  eye: Eye,
  eyeOff: EyeOff,
  fastForward: FastForward,
  file: File,
  forward: Forward,
  groupAdd: UserPlus,
  language: Globe,
  maximize: Maximize,
  pause: Pause,
  play: Play,
  warning: AlertTriangle,
  phone: Phone,
  pin: Pin,
  reply: Reply,
  rewind: Rewind,
  search: Search,
  settings: Settings,
  trash: Trash2,
  users: Users,
  video: Video,
  volume: Volume2,
  volumeMute: VolumeX,
};

export const Icon = ({ name, size = "md", className, ...props }: Props) => {
  const SVGIcon = iconsConfig[name];
  return <SVGIcon {...props} className={cn(sizes[size], "stroke-[1.75px]", className)} />;
};
