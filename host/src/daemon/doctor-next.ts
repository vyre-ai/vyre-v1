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
  ingress: "vyred writes the route within a minute of starting once Caddy answers. If it stays missing, run vyre-server restart and read vyre-server logs vyred.",
  logs: "Read them with vyre logs --level error.",
} as const;

