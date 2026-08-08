import React from 'react';

// Импортируем все созданные компоненты иконок
import PinIcon from './Icons/Pin';
import LanguageIcon from './Icons/Language';
import CheckCircleIcon from './Icons/CheckCircle';
import ForwardIcon from './Icons/Forward';
import MessageCircleIcon from './Icons/MessageCircle';
import ReplyIcon from './Icons/Reply';
import EditIcon from './Icons/Edit';
import TrashIcon from './Icons/Trash';
import PhoneIcon from './Icons/Phone';
import VideoIcon from './Icons/Video';
import CopyIcon from './Icons/Copy';
import BackIcon from './Icons/Back';
import MediaFileIcon from './Icons/MediaFile';

// Карта соответствия имён и компонентов
const iconMap = {
    pin: PinIcon,
    language: LanguageIcon,
    'check-circle': CheckCircleIcon,
    forward: ForwardIcon,
    'message-circle': MessageCircleIcon,
    reply: ReplyIcon,
    edit: EditIcon,
    trash: TrashIcon,
    phone: PhoneIcon,
    video: VideoIcon,
    copy: CopyIcon,
    back: BackIcon,
    'media-file': MediaFileIcon,
} as const;

export type IconName = keyof typeof iconMap;

export interface IconProps extends React.SVGProps<SVGSVGElement> {
    name: IconName;
}

export const Icon = ({ name, ...props }: IconProps) => {
    const IconComponent = iconMap[name];

    if (!IconComponent) {
        console.warn(`Иконка с именем "${name}" не найдена.`);
        return null;
    }

    return <IconComponent {...props} />;
};
