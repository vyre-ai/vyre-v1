# voice.space_changed

Talk for everyone in the Space was turned on or off

| | |
|---|---|
| Module | voice |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  on: boolean;
  by: string;
};
```
