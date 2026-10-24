# number.route_changed

A number route, hours or recording policy changed

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | number at /numberId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  numberId: string;
  fields: Array<string>;
};
```
