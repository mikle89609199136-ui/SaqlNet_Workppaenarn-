import type { TIconProps } from '../Icon';

export const ReplyIcon = (props: TIconProps) => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M10 8.5V4L3 10.5 10 17v-4.6h4.4c2.3 0 4.1 1.1 5.6 3.4-.4-4.6-2.9-7.3-7.5-7.3H10Z" />
    </svg>
  );
};
