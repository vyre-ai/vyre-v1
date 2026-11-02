# voice.space_checked

The Space key was checked with the provider

| | |
|---|---|
| Module | voice |
| Schema version | 1 |
| Subject | entity at /state |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  state: "ok" | "failing";
};
```
