# checklist.dismissed

The first-run checklist was dismissed or finished

| | |
|---|---|
| Module | home |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  reason: "done" | "dismissed";
};
```
