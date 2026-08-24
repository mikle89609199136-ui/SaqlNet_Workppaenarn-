// Deterministic GitHub-style identicon: symmetric 5x5 grid colored by user ID hash.
function hashBytes(str: string) {
  const bytes = new Uint8Array(16);
  let seed = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    seed ^= str.charCodeAt(i);
    seed = (Math.imul(seed, 0x01000193) >>> 0);
  }
  for (let i = 0; i < 16; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes[i] = (seed >>> 24) & 0xff;
  }
  return bytes;
}

interface Props {
	userId: string | null
	size: number
	className?: string
}

export function Identicon({ userId = '', size = 40, className = '' }: Props) {
  const h = hashBytes(userId || 'anon');

  // Hue from first 2 bytes, saturation/lightness fixed for nice look
  const hue = ((h[0] << 4) | (h[1] >> 4)) % 360;
  const fg = `hsl(${hue},65%,65%)`;
  const bg = `hsl(${hue},20%,12%)`;

  // 5x5 symmetric grid — only 3 cols needed (col 3 mirrors col 1, col 4 mirrors col 0)
  const cell = size / 5;
  const rects = [];
  let byteIdx = 2;
  let bitShift = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const filled = (h[byteIdx] >> bitShift) & 1;
      bitShift++;
      if (bitShift === 8) { bitShift = 0; byteIdx++; }
      if (!filled) continue;
      const x1 = col * cell;
      const x2 = (4 - col) * cell;
      rects.push(<rect key={`${row}-${col}`} x={x1} y={row * cell} width={cell} height={cell} fill={fg} />);
      if (col !== 2) {
        rects.push(<rect key={`${row}-m${col}`} x={x2} y={row * cell} width={cell} height={cell} fill={fg} />);
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}
    >
      <rect width={size} height={size} fill={bg} />
      {rects}
    </svg>
  );
}
