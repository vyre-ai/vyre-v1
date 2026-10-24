# document.template_marked

A file was marked or unmarked as a template

| | |
|---|---|
| Module | documents |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId: string;
  isTemplate: boolean;
};
```
