import type { SVGProps } from 'react';

import type { TIconTypes } from '@/types';
import {
  BurgerIcon,
  CameraIcon,
  ChannelIcon,
  ChatIcon,
  CheckCircleIcon,
  CopyIcon,
  CrossIcon,
  EditIcon,
  FileIcon,
  ForwardIcon,
  LanguageIcon,
  PhoneIcon,
  PinIcon,
  ReplyIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  UsersIcon,
  VideoIcon,
} from './icons';

export type TIconProps = SVGProps<SVGSVGElement>;

interface Props extends SVGProps<SVGSVGElement> {
  name: TIconTypes;
}

const iconsConfig: Record<TIconTypes, any> = {
  burger: BurgerIcon,
  camera: CameraIcon,
  channel: ChannelIcon,
  chat: ChatIcon,
  checkCircle: CheckCircleIcon,
  copy: CopyIcon,
  cross: CrossIcon,
  edit: EditIcon,
  file: FileIcon,
  forward: ForwardIcon,
  language: LanguageIcon,
  phone: PhoneIcon,
  pin: PinIcon,
  reply: ReplyIcon,
  search: SearchIcon,
  settings: SettingsIcon,
  trash: TrashIcon,
  users: UsersIcon,
  video: VideoIcon,
};

export const Icon = ({ name, ...props }: Props) => {
  const SVGIcon = iconsConfig[name];
  return <SVGIcon {...props} />;
};
