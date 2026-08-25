import type { TIconProps } from '../Icon';

export const TrashIcon = (props: TIconProps) => {
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
      <path d="M8.5 4.5 9.4 3h5.2l.9 1.5H20v2H4v-2h4.5Zm-2.2 4h11.4l-.8 11A2.5 2.5 0 0 1 14.4 22H9.6a2.5 2.5 0 0 1-2.5-2.5l-.8-11Z" />
    </svg>
  );
};
