# microsoft.consent_revoked

The Microsoft connection was turned off

| | |
|---|---|
| Module | microsoft |
| Schema version | 1 |
| Subject | connector at /connector |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  connector: "microsoft";
  by: string;
};
```
