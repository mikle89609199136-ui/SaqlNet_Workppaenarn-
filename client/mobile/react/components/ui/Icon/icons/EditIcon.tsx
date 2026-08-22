import type { TIconProps } from '../Icon';

export const EditIcon = (props: TIconProps) => {
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
      <path d="M4.5 16.9v2.6h2.6L17.8 8.8l-2.6-2.6L4.5 16.9Zm14.9-9.7a1.4 1.4 0 0 0 0-2l-.6-.6a1.4 1.4 0 0 0-2 0l-.7.7 2.6 2.6.7-.7Z" />
    </svg>
  );
};
