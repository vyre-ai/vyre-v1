// 30 pairs for calibrating meaning search: a question and a stored fact, 15 where the fact answers the question and 15 where it does not (half of those from the same office, so they share a setting but not a subject).
// The threshold in modules/memory/meaning.ts is chosen on this set, and modules/memory/tests/meaning.pairs.test.ts holds a model's scores to it.
export interface Pair { query: string; text: string; related: boolean }

const RELATED: Array<[string, string]> = [
  ["bank reconciliation", "The Chase feed didn't match"],
  ["who does payroll", "Maria runs payroll on the 15th"],
  ["client intake form", "New clients fill out the Clio questionnaire before the first call"],
  ["office hours", "We are open 9 to 5 Monday through Friday"],
  ["retainer amount", "Harlow pays 4000 a month on retainer"],
  ["how does Dana like updates", "Dana prefers a short Friday summary by email"],
  ["conflict check", "Run the conflicts search in Lawmatics before signing anyone"],
  ["trust account rules", "Never move client funds out of IOLTA without the partner approving"],
  ["what software for billing", "We bill through QuickBooks and invoices go out on the 1st"],
  ["holiday schedule", "The office is closed the last week of December"],
  ["who to call for IT trouble", "Omar handles laptop and wifi problems"],
  ["court filing deadline", "Motions are due 14 days before the hearing"],
  ["new hire onboarding", "First-day checklist: badge, laptop, benefits forms"],
  ["expense reimbursement", "Receipts over 25 dollars must be uploaded to Expensify within a week"],
  ["marketing newsletter", "The monthly email goes out the first Tuesday via Mailchimp"],
];
const UNRELATED: Array<[string, string]> = [
  ["bank reconciliation", "The forecast says rain on Friday"],
  ["who does payroll", "The conference room projector needs a new bulb"],
  ["client intake form", "Omar prefers oat milk in his coffee"],
  ["office hours", "The Harlow retainer is 4000 a month"],
  ["retainer amount", "Parking validation is at the front desk"],
  ["how does Dana like updates", "The IOLTA account is at First Republic"],
  ["conflict check", "The holiday party is on December 12th"],
  ["trust account rules", "Maria's desk is by the window"],
  ["what software for billing", "Motions are due 14 days before the hearing"],
  ["holiday schedule", "Receipts over 25 dollars must be uploaded to Expensify within a week"],
  ["who to call for IT trouble", "The monthly email goes out the first Tuesday via Mailchimp"],
  ["court filing deadline", "We are open 9 to 5 Monday through Friday"],
  ["new hire onboarding", "The Chase feed didn't match"],
  ["expense reimbursement", "Dana prefers a short Friday summary by email"],
  ["marketing newsletter", "Never move client funds out of IOLTA without the partner approving"],
];

export const PAIRS: readonly Pair[] = [
  ...RELATED.map(([query, text]) => ({ query, text, related: true })),
  ...UNRELATED.map(([query, text]) => ({ query, text, related: false })),
];

/** Precision and recall of "related" when a score at or above `threshold` counts as related. */
export function scoreAt(scores: readonly number[], threshold: number): { precision: number; recall: number; f1: number } {
  let tp = 0, fp = 0, fn = 0;
  PAIRS.forEach((p, i) => {
    const hit = (scores[i] ?? 0) >= threshold;
    if (hit && p.related) tp++; else if (hit) fp++; else if (p.related) fn++;
  });
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  return { precision, recall, f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall) };
}
