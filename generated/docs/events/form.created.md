# form.created

A form was created as a draft

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
  name: string;
  kind: string;
};
```
