# ms.consent.disable

Turn the Microsoft connection off and stop every member sync

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/consent/disable |
| MCP tool | ms_consent_disable (engineer) |
| CLI | none |
| Emits | microsoft.consent_revoked |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  disabled: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "disabled": true
  }
}
```
