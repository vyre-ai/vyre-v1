# mounts.company_drive

Bring the person's own Drive or OneDrive into their Personal folder, with nothing to sign in to, once the company connected Files. Runs as the person; nothing for anyone excluded

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mounts/company_drive |
| MCP tool | none |
| CLI | none |
| Emits | folder.mounted |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  mounted: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "mounted": [
      "mnt_a1b2c3"
    ]
  }
}
```
