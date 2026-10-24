# microsoft.consent_configured

The Microsoft app registration was stored and members mapped

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
  tenantId: string;
  mappedMembers: number;
  autoConnect: boolean;
};
```
