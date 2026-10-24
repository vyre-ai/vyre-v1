# record.gaps_found

A gap-check rule found missing or stale fields on a record

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A record has gaps |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  type: string;
  fields: Array<string>;
  ruleId: string;
};
```
