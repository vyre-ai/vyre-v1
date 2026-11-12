// The code hashes a phone-address Space offers its relay box for invite hellos (seams/relay.ts openInvite, and the channel's InviteScope.open): every open, unexpired invite's current code,
// and the earlier codes a replayed create kept valid (members_invite_codes, 12 Nov 2026), newest invite first, at most `limit`. Without the second, the first link of a replayed invite opened on
// a computer and failed on a phone address (review Pass 7).
export interface InviteDb {
  all(sql: string, ...args: unknown[]): unknown[];
}

export function openInviteHashes(db: InviteDb | null | undefined, now: number, limit: number): string[] {
  if (!db) return [];
  try {
    const rows = db.all(
      `SELECT code_hash FROM (
         SELECT code_hash, created_at, 0 AS earlier FROM members_invites WHERE state = 'open' AND expires_at > ?
         UNION ALL
         SELECT c.code_hash AS code_hash, i.created_at AS created_at, 1 AS earlier FROM members_invite_codes c JOIN members_invites i ON i.id = c.invite WHERE i.state = 'open' AND i.expires_at > ?
       ) ORDER BY created_at DESC, earlier ASC LIMIT ?`,
      now,
      now,
      limit,
    ) as { code_hash: string }[];
    return rows.map((r) => r.code_hash);
  } catch {
    // a Space whose members module has not made members_invite_codes yet: the current codes, as before
    try {
      return (
        db.all(
          "SELECT code_hash FROM members_invites WHERE state = 'open' AND expires_at > ? ORDER BY created_at DESC LIMIT ?",
          now,
          limit,
        ) as { code_hash: string }[]
      ).map((r) => r.code_hash);
    } catch {
      return [];
    }
  }
}
