/**
 * InfraBit brand mark (self-hosted PNG, same-origin so strict CSP `img-src 'self'` holds).
 *
 * Used wherever the app previously drew a rounded monogram badge: onboarding welcome, unlock,
 * the settings wallet card and the wallet switcher rows. Size and aspect ratio are fixed (square)
 * so it stays crisp in both Mint Light and Forest Dark.
 */
import logoUrl from '../assets/infrabit-logo-512.png';

export function InfraBitLogo({ size = 88, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="InfraBit"
      draggable={false}
      data-testid="infrabit-logo"
      className={`shrink-0 rounded-[22%] object-cover no-select ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
