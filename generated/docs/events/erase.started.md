# erase.started

Erasing a person's data started (who and when; never what)

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
  by: string;
  overrodeHold: boolean;
};
```
