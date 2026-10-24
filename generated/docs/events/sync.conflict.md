# sync.conflict

Both sides changed the same field and the rule asks a person (values are not in the payload)

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A sync conflict appears |
| Notification | conflict.needs_you |
| Retention | default |

## Payload

```ts
type Payload = {
  conflictId: string;
  syncTypeId: string;
  type: string;
  recordId: string;
  field: string;
  rule: "newest" | "source" | "vyre" | "ask";
};
```
