// Sensitivity labels and ranks (spec 2.3, 4.12 step 3).
import type { Label } from './types.ts';

export const LABELS: readonly Label[] = ['public', 'internal', 'confidential', 'restricted'];
export const LABEL_RANK: Record<Label, 0 | 1 | 2 | 3> = { public: 0, internal: 1, confidential: 2, restricted: 3 };

export function labelRank(l: Label): number {
  return LABEL_RANK[l];
}

/** A label is readable when its rank is at or below the clearance. */
export function withinClearance(label: Label, clearance: Label): boolean {
  return LABEL_RANK[label] <= LABEL_RANK[clearance];
}
