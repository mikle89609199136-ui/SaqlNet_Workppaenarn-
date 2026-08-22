import type { TIconProps } from '../Icon';

export const CopyIcon = (props: TIconProps) => {
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
      <path d="M8 7.5A2.5 2.5 0 0 1 10.5 5H18a2.5 2.5 0 0 1 2.5 2.5V15A2.5 2.5 0 0 1 18 17.5h-7.5A2.5 2.5 0 0 1 8 15V7.5Zm-4.5 2A2.5 2.5 0 0 1 6 7h.5v2H6a.5.5 0 0 0-.5.5V18a.5.5 0 0 0 .5.5h8.5a.5.5 0 0 0 .5-.5v-.5h2v.5a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V9.5Z" />
    </svg>
  );
};
