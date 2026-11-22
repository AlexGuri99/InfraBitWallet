/**
 * Inline SVG QR code (no external image, no canvas data URL). Generated locally from a public
 * address; fits the strict CSP.
 */
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QrCode({
  value,
  size = 160,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${String(col)} ${String(row)}h1v1h-1z`;
      }
    }
    return { d, count };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${String(path.count)} ${String(path.count)}`}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white p-2"
    >
      <rect width={path.count} height={path.count} fill="#ffffff" />
      <path d={path.d} fill="#000000" />
    </svg>
  );
}
