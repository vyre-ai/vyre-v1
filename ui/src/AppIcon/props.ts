// Props for ui/AppIcon: the one tile that stands for an app or a service (Gmail, Stripe, GitHub, Claude ...) in every list, menu and sheet.
// The tile is neutral (sunk ground, one ring) and carries the brand's own mark in its own colour; an app without a mark gets a clean letter.

export interface AppIconProps {
  /** A brand key (stripe, gmail, github, db, aws ...), a generic glyph (card, login, blank) or anything else, which draws a letter tile. */
  brand: string;
  /** Edge in px. Defaults to 28, the size of a list row logo. */
  size?: number;
  /** The word the letter fallback and the accessible label come from when the brand has no mark. Defaults to the brand key. */
  name?: string;
  testID?: string;
}
