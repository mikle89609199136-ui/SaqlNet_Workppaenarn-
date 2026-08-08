import {SVGProps} from 'react';

const Reply = (props: SVGProps<SVGSVGElement>) => (
    <svg
        xmlns="http://w3.org"
        viewBox="0 0 24 24"
        fill="currentColor"
        width="1em"
        height="1em"
        {...props}
    >
        <path d="M10 8.5V4L3 10.5 10 17v-4.6h4.4c2.3 0 4.1 1.1 5.6 3.4-.4-4.6-2.9-7.3-7.5-7.3H10Z" />
    </svg>
);

export default Reply;