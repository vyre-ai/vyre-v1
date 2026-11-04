// A person putting back an earlier revision of a mounted file that an agent had changed teaches that agent (lib/reversal.ts, memory.corrections.record).
export const REVERSALS = {
  "mounts.restore": { subject: (i: { fileId: string }) => ({ type: "file", id: i.fileId }), types: ["file.version_added", "file.created"], was: () => "changed a file in a connected folder" },
};
