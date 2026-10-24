# sending_domain.checked

SPF, DKIM and DMARC were checked

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
  spf: "pass" | "fail" | "pending";
  dkim: "pass" | "fail" | "pending";
  dmarc: "pass" | "fail" | "pending";
};
```
