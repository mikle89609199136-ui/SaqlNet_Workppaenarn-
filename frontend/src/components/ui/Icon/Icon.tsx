import type { TIconTypes } from '@/types';
import { cn } from '@/utils';
import { AlertTriangle, Camera, CheckCircle, Copy, Eye, EyeOff, File, Forward, Globe, Info, Megaphone, Menu, MessageCircle, Pencil, Phone, Pin, Reply, Search, Settings, Trash2, UserPlus, Users, Video, X, type LucideIcon, type LucideProps } from 'lucide-react';

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
  checkCircle: CheckCircle,
  copy: Copy,
  cross: X,
  info: Info,
  edit: Pencil,
  eye: Eye,
  eyeOff: EyeOff,
  file: File,
  forward: Forward,
  groupAdd: UserPlus,
  language: Globe,
  warning: AlertTriangle,
  phone: Phone,
  pin: Pin,
  reply: Reply,
  search: Search,
  settings: Settings,
  trash: Trash2,
  users: Users,
  video: Video,
};

export const Icon = ({ name, size = "md", className, ...props }: Props) => {
  const SVGIcon = iconsConfig[name];
  return <SVGIcon {...props} className={cn(sizes[size], "stroke-[1.75px]", className)} />;
};
