# google.dwd.scopes

The scope list and client id to paste into the Google Admin console

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/dwd/scopes |
| MCP tool | google_dwd_scopes (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  scopes: Array<string>;
  clientId?: string;
  adminConsoleUrl: string;
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
    "adminConsoleUrl": "example",
    "clientId": "example",
    "scopes": [
      "example"
    ]
  }
}
```
