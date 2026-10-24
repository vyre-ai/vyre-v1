# audit.exported

The audit log was exported (the export is itself audited)

| | |
|---|---|
| Module | audit |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  by: string;
  rows: number;
  fileId: string;
};
```
