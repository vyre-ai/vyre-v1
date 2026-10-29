# memory.archive_sweep

Daily job: move facts untouched in Trash for the Space setting (30 to 90 days, default 60) to Archive

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/archive_sweep |
| MCP tool | none |
| CLI | none |
| Emits | memory.archived |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  archived: number;
  days: number;
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
    "archived": 1,
    "days": 1
  }
}
```
