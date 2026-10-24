# log.accessed

Someone read logs (reading logs is itself audited)

| | |
|---|---|
| Module | logs |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  by: string;
  filter: Record<string, unknown>;
};
```
