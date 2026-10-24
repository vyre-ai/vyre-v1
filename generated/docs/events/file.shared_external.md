# file.shared_external

A link outside the Space was made for a file

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId: string;
  linkId: string;
  expiresAt?: number;
};
```
