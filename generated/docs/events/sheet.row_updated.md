# sheet.row_updated

A row of a sheet changed

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A sheet row changes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId: string;
  sheet: string;
  rowId: string;
  columns: Array<string>;
  runId?: string;
};
```
