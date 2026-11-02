# talk.configured

A person's Talk choices changed

| | |
|---|---|
| Module | talk |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  on: boolean;
  provider: string;
  language: string;
  model: string;
  by: string;
};
```
