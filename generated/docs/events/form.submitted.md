# form.submitted

A form was submitted; the record was written with source link holder

| | |
|---|---|
| Module | forms |
| Schema version | 1 |
| Subject | form at /formId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A form is submitted |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  formId: string;
  recordId: string;
  type: string;
  matched: boolean;
};
```
