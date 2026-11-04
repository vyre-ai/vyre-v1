# github.me_connected

A person connected their own GitHub

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
  source: "space" | "vyre";
};
```
