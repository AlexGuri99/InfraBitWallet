/**
 * Inline SVG icon set (strict CSP: no external assets, no icon fonts).
 * Every icon is decorative by default; label the interactive parent with aria-label.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M6 13l6 6 6-6" />
  </Svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5" />
    <path d="M6 11l6-6 6 6" />
  </Svg>
);

export const SwapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h13l-3-3" />
    <path d="M20 16H7l3 3" />
  </Svg>
);

export const EarnIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v8M9.2 10.6h4.2a1.8 1.8 0 1 1 0 3.6H9.2" />
  </Svg>
);

export const EyeIcon = ({ hidden = false, ...p }: IconProps & { hidden?: boolean }) => (
  <Svg {...p}>
    {hidden ? (
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.2A10 10 0 0 1 12 5c5 0 9 7 9 7a17 17 0 0 1-2.2 3.1M6.1 6.1A17 17 0 0 0 3 12s4 7 9 7a9.9 9.9 0 0 0 3.9-.8" />
      </>
    ) : (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </Svg>
);

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5Z" />
  </Svg>
);

export const QrIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 14h3v3M20 14v.01M20 20h-3M14 20v.01" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 1 1 8 0v3" />
  </Svg>
);

export const WalletIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
    <rect x="3" y="7.5" width="18" height="12" rx="3" />
    <path d="M16.5 13.5h.01" />
  </Svg>
);

export const MarketIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="M7 15l4-5 3 3 5-7" />
  </Svg>
);

export const SparkleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3Z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8" />
    <path d="M10.5 20a2 2 0 0 0 3 0" />
  </Svg>
);

export const GlobeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5Z" />
    <path d="M3 13l9 5 9-5" />
    <path d="M3 17l9 5 9-5" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const FingerprintIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4a8 8 0 0 0-8 8v3" />
    <path d="M12 8a4 4 0 0 0-4 4v5" />
    <path d="M12 12a1 1 0 0 0-1 1v6" />
    <path d="M16 12a4 4 0 0 0-1-2.65" />
    <path d="M20 12a8 8 0 0 0-3-6.25" />
    <path d="M20 15v1" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const KeyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M17 6l2 2M14 9l2 2" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 3L10 14" />
    <path d="M21 3l-7 18-4-7-7-4 18-7Z" />
  </Svg>
);
