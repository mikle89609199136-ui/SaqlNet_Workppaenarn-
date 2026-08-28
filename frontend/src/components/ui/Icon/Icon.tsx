import type { TIconTypes } from '@/types';
import { cn } from '@/utils';
import { Camera, CheckCircle, Copy, File, Forward, Globe, Menu, MessageCircle, Pencil, Phone, Pin, Plus, Reply, Search, Settings, Trash2, Users, Video, Volume2, X, type LucideIcon, type LucideProps } from 'lucide-react';

const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-6', xl: 'size-8' } as const;

interface Props extends Omit<LucideProps, 'size' | 'ref'> {
  name: TIconTypes;
  size?: keyof typeof sizes;
}

const iconsConfig: Record<TIconTypes, LucideIcon> = {
  burger: Menu,
  camera: Camera,
  megaphone: Volume2,
  chat: MessageCircle,
  checkCircle: CheckCircle,
  copy: Copy,
  cross: X,
  edit: Pencil,
  file: File,
  forward: Forward,
  userPlus: Plus,
  language: Globe,
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
