# file.redacted

Part of a file (or a piece of a name) was hidden from AI

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId?: string;
  folderId?: string;
  markId: string;
  shape: string;
  label?: string;
  by: string;
  byAgent?: string;
  placed?: boolean;
};
```
