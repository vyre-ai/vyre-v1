# provider.updated

A provider changed (Space may use it, sign-in state)

| | |
|---|---|
| Module | vault |
| Schema version | 1 |
| Subject | entity at /providerId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  providerId: string;
  spaceMayUse?: boolean;
  state?: "ok" | "needs_sign_in" | "failing";
};
```
