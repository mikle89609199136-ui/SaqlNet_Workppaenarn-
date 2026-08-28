import type { SVGProps } from 'react';

import type { TIconTypes } from '@/types';
import { cn } from '@/utils';
import { Camera, CheckCircle, Copy, File, Forward, Globe, Menu, MessageCircle, Pencil, Phone, Pin, Plus, Reply, Search, Settings, Trash2, Users, Video, Volume2, X } from 'lucide-react';

export type TIconProps = SVGProps<SVGSVGElement>;

interface Props extends SVGProps<SVGSVGElement> {
  name: TIconTypes;
}

const iconsConfig: Record<TIconTypes, any> = {
  burger: Menu,
  camera: Camera,
  channel: Volume2,
  chat: MessageCircle,
  checkCircle: CheckCircle,
  copy: Copy,
  cross: X,
  edit: Pencil,
  file: File,
  forward: Forward,
  groupAdd: Plus,
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

export const Icon = ({ name, ...props }: Props) => {
  const SVGIcon = iconsConfig[name];
  return <SVGIcon {...props} className={cn("size-5 stroke-[1.75px]", props.className)} />;
};
