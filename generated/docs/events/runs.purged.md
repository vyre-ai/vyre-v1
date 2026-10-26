# runs.purged

Runs past their retention were removed with their step logs (a count)

| | |
|---|---|
| Module | runs |
| Schema version | 1 |
| Subject | entity at /removed |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  removed: number;
};
```
