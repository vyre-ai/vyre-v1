# file.created

A file was created

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A file is created |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId: string;
  folderId: string;
  name: string;
  kind: "text" | "markdown" | "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "video" | "audio" | "code" | "archive" | "google_native" | "other";
  by: string;
};
```
