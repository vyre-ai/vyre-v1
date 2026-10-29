# memory.key.set

Pick the account that pays for memory upkeep: yours for personal memory, or (admins) the Space's or a project's; null clears it and upkeep stays rule-based

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/memory/key/set |
| MCP tool | memory_key_set (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  layer: "space" | "project" | "person";
  projectId?: string;
  accountRef: string | null;
};
```

## Output

```ts
type Out = {
  layer: "space" | "project" | "person";
  accountRef: string | null;
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
  "input": {
    "accountRef": "example",
    "layer": "space",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "accountRef": "example",
    "layer": "space"
  }
}
```
