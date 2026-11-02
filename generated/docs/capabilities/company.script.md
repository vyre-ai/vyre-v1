# company.script

The one paste that does the provider's side: which shell to open and the script. It holds no secret; the admin runs it under their own account

| | |
|---|---|
| Module | members |
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
| HTTP | POST /v1/company/script |
| MCP tool | company_script (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  provider: "google" | "microsoft";
};
```

## Output

```ts
type Out = {
  shell: string;
  url: string;
  script: string;
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
  "input": {
    "provider": "google"
  },
  "output": {
    "script": "example",
    "shell": "example",
    "url": "example"
  }
}
```
