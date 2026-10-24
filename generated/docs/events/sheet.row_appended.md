# sheet.row_appended

A row was added to a sheet

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A row is added to a sheet |
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
