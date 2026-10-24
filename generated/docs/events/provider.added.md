# provider.added

An AI provider was connected (subscription, key or local model)

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
  providerKey: string;
  connection: "subscription" | "api_key" | "local_model";
  scope: "mine" | "shared";
};
```
