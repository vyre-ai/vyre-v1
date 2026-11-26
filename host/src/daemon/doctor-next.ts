// The plain next step doctor gives for each check, kept apart from doctor.ts so the Machines module can say the same words in its alerts without loading the doctor itself.
export const OK = "No action needed.";
export const NEXT = {
  process: "Start it with vyre server start.",
  disk: "Enable FileVault or LUKS for the data directory, then run vyre-server doctor.",
  diskProvider: "Confirm with your provider that encryption at rest is on for the data volume.",
  diskPlain: "To clear this, re-run the installer with the data on an encrypted volume.",
  dockerRoot: "Move Docker's data root onto the encrypted volume, or encrypt its disk.",
  dockerRootUnknown: "Check the encryption of the disk Docker's data lives on yourself.",
  space: "Free disk space or extend the volume.",
  events: "Restore from the last backup (Console, Data, Backups), then run vyre-server doctor again.",
  docker: "Start Docker or Colima; sites and agent computers need it.",
  caddy: "Restart Caddy in Console, Infrastructure, Services.",
  ingress:
    "vyred writes the route within a minute of starting once Caddy answers. If it stays missing, run vyre-server restart and read vyre-server logs vyred.",
  logs: "Read them with vyre logs --level error.",
  recordEvents:
    "The records are safe in the Space, but search, sync and Run undo do not see them. Report the count to support.",
  hiddenRunData:
    "Runs made before this release kept the record's fields in their history, among them fields the person's access hides. Nothing is changed by this check. Report the counts to support before anyone clears the history.",
  searchRemovedText:
    "The one-time check of the search index reads the records again by itself, a few at a time, and takes the old text out. Run the doctor again in a few minutes; if the count does not go down, report it to support.",
  purgeOwedCompact:
    "Run the planned compact (vyre-server compact) in a quiet window. Until then the removed values are zeroed in the file but its freed pages stay.",
  journalNotFolded:
    "Restart the server in a quiet moment (vyre-server restart); the journal is folded at the next start. Until then the search index's journal file may still hold text that was removed.",
  computedFields:
    "Open the table in Records, Fields, and save the stuck field again without changing it: the fill goes on from where it stopped. If it stays stuck, report the type and field to support.",
} as const;
