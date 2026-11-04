# settings.contact_verified

My email or phone was confirmed with its code

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
};
```
