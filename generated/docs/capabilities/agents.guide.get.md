# agents.guide.get

The Vyre agent guide (.vyre/guide.md): version and text, rewritten by app updates, loaded into every chat before VYRE.md

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/agents/guide/get |
| MCP tool | agents_guide_get (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  version: string;
  path: ".vyre/guide.md";
  body: string;
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
    "body": "example",
    "path": ".vyre/guide.md",
    "version": "1.0.0"
  }
}
```
