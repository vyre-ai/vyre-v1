# mounts.file_link

Where a mounted file opens at its provider (Google Docs, Sheets, Slides, Word, Excel, PowerPoint, Dropbox) and what an agent can do to it in place

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mounts/file_link |
| MCP tool | mounts_file_link (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  link?: {
    mountId: string;
    kind: "google_drive" | "sharepoint" | "onedrive" | "dropbox" | "local" | "github";
    type: "google_doc" | "google_sheet" | "google_slides" | "google_file" | "word" | "excel" | "powerpoint" | "sharepoint_file" | "onedrive_file" | "dropbox_file";
    openIn: string;
    webUrl: string;
    edit: Array<"replace_text" | "insert_text" | "read_cells" | "write_cells" | "append_rows">;
  };
  reason?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "link": {
      "edit": [
        "replace_text"
      ],
      "kind": "google_drive",
      "mountId": "mnt_a1b2c3",
      "openIn": "Google Docs",
      "type": "google_doc",
      "webUrl": "example"
    },
    "reason": "example"
  }
}
```
