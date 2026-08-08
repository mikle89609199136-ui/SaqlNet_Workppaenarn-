import React from 'react';

const ForwardIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
        <path d="m15 17 5-5-5-5" />
        <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
);

export default ForwardIcon;
