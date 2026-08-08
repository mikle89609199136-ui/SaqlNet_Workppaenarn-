import React from 'react';

const CheckCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
        <circle cx={12} cy={12} r={10} />
        <path d="m9 12 2 2 4-4" />
    </svg>
);

export default CheckCircleIcon;
