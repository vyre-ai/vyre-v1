# form.choices_changed

The records or people a public question offers were changed by its publisher

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
  field: string;
  count: number;
};
```
