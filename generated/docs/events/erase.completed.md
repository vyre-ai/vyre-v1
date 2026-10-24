# erase.completed

Erasing finished; tombstones are written and the next backup rotation purges the rest

| | |
|---|---|
| Module | governance |
| Schema version | 1 |
| Subject | entity at /findingId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  findingId: string;
  tombstones: number;
};
```
