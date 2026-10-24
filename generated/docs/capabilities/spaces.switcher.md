# spaces.switcher

This Space tile for the switcher: name, logo, kind, role, and whether it needs the person (red dot)

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/spaces/switcher |
| MCP tool | spaces_switcher (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  name: string;
  logoFileId?: string;
  kind: "personal" | "team";
  role: string;
  needsYou: number;
  unread: number;
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
    "kind": "personal",
    "logoFileId": "fil_a1b2c3",
    "name": "example",
    "needsYou": 1,
    "role": "example",
    "unread": 1
  }
}
```
