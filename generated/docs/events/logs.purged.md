# logs.purged

Log rows past their retention were removed (a count)

| | |
|---|---|
| Module | logs |
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
