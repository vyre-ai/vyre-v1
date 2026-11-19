// An address a key may be sent to, in the words a person reads. A pattern the connector declares (*.app.n8n.cloud, or the record's domain:*.app.n8n.cloud:443) reads as what it allows; an exact host stays as it is.
export function hostWords(entry: string): string {
  const m = /^(?:domain:)?(\*\.)?([^:/\s]+)(?::(\d{1,5}))?$/.exec(entry.trim().toLowerCase());
  if (!m) return entry;
  const port = m[3] && m[3] !== "443" ? ` on port ${m[3]}` : "";
  return m[1] ? `any address ending in .${m[2]}${port}` : `${m[2]}${port}`;
}
