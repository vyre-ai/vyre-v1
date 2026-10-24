# automations.versions

List versions of an Automation (One History)

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/versions |
| MCP tool | automations_versions (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
};
```

## Output

```ts
type Out = {
  versions: Array<{
      versionId: string;
      n: number;
      by: string;
      at: number;
      reason?: string;
      name?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3"
  },
  "output": {
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "n": 1,
        "name": "example",
        "reason": "example",
        "versionId": "ver_a1b2c3"
      }
    ]
  }
}
```
