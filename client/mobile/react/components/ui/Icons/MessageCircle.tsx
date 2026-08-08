import React from 'react';

const MessageCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
        <path d="M20.5 11.8a8 8 0 0 1-8.3 7.7 8.6 8.6 0 0 1-3.3-.66L4.3 20l1.16-4A7.6 7.6 0 0 1 4.5 12 8 8 0 0 1 12.8 4.5a8 8 0 0 1 7.7 7.3Z" />
    </svg>
);

export default MessageCircleIcon;
