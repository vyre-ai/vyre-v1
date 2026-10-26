# email.created

An email design was created, in a folder or at the top of the Space

| | |
|---|---|
| Module | email-builder-api |
| Schema version | 1 |
| Subject | email at /emailId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  emailId: string;
  folderId?: string;
};
```
