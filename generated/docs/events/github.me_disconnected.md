# github.me_disconnected

A person disconnected their GitHub

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  person: string;
  login: string;
};
```
