# settings.contact_unverified

My email or phone changed, so its tick went

| | |
|---|---|
| Module | settings |
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
  channel: "email" | "phone";
  why: string;
};
```
