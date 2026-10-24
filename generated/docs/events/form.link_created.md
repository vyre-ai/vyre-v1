# form.link_created

A one-use or signed record link was made

| | |
|---|---|
| Module | forms |
| Schema version | 1 |
| Subject | form at /formId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  formId: string;
  recordId: string;
  expiresAt?: number;
};
```
