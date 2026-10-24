# network.certificate_renewed

A certificate was issued or renewed

| | |
|---|---|
| Module | network |
| Schema version | 1 |
| Subject | entity at /host |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  host: string;
  expiresAt: number;
};
```
