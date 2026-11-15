# state.layout_changed

A person's layout value changed (how they arranged a screen): their other devices take the new value

| | |
|---|---|
| Module | state |
| Schema version | 1 |
| Subject | entity at /key |
| Visibility | private |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  key: string;
  value: unknown;
  version: number;
  now: number;
  by: string;
};
```
