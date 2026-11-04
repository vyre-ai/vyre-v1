# provider.keeps_nothing_changed

An owner or admin marked an AI account as keeping nothing, or took the mark off

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
  keepsNothing: boolean;
};
```
