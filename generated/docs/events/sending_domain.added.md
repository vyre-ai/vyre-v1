# sending_domain.added

A sending domain was added

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | domain at /domainId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  domainId: string;
  name: string;
  provider: "resend" | "mailgun";
};
```
