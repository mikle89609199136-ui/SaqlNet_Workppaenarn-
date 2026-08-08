import {SVGProps} from 'react';

const Trash = (props: SVGProps<SVGSVGElement>) => (
    <svg
        xmlns="http://w3.org"
        viewBox="0 0 24 24"
        fill="currentColor"
        width="1em"
        height="1em"
        {...props}
    >
        <path d="M8.5 4.5 9.4 3h5.2l.9 1.5H20v2H4v-2h4.5Zm-2.2 4h11.4l-.8 11A2.5 2.5 0 0 1 14.4 22H9.6a2.5 2.5 0 0 1-2.5-2.5l-.8-11Z" />
    </svg>
);

export default Trash;
