# microsoft.consent_verified

A consent and access policy check ran

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
  ok: boolean;
  missingPermissions: Array<string>;
};
```
