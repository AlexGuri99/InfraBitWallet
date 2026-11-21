/**
 * Short-lived holder for a recovery phrase during onboarding or settings re-auth.
 *
 * It is deliberately NOT React state, Zustand, localStorage, sessionStorage or a URL. A module
 * variable can be overwritten as soon as the flow ends, but a JavaScript string cannot be
 * zero-filled; docs/VAULT_DESIGN.md records that limitation. The UI must still clear it on
 * navigation, on background and after any verification.
 */
let phrase: string | null = null;

export const secretHolder = {
  set(next: string): void {
    phrase = next;
  },
  get(): string | null {
    return phrase;
  },
  words(): string[] {
    return phrase ? phrase.split(' ') : [];
  },
  clear(): void {
    phrase = null;
  },
  has(): boolean {
    return phrase !== null;
  },
};
