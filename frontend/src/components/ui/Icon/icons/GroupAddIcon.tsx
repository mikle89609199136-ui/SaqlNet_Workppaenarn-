import type { TIconProps } from '../Icon';

export const GroupAddIcon = (props: TIconProps) => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="8.5" cy="7" r="3.5" />
      <line x1="18" y1="7" x2="18" y2="13" />
      <line x1="15" y1="10" x2="21" y2="10" />
    </svg>
  );
};
