# sheet.row_deleted

A row was removed from a sheet

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
  fileId: string;
  sheet: string;
  rowId: string;
  runId?: string;
};
```
