import React from 'react';

const BackIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg
        xmlns="http://w3.org"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width="1em"
        height="1em"
        {...props}
    >
        <path d="m15 18-6-6 6-6" />
    </svg>
);

export default BackIcon;
