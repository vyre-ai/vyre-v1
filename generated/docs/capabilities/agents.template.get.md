# agents.template.get

The Agent template: version, files, and the propagation mode

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
| HTTP | POST /v1/agents/template/get |
| MCP tool | agents_template_get (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  version: number;
  files: Array<string>;
  mode: "suggest" | "new_only" | "off";
  agents: number;
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
    "agents": 1,
    "files": [
      "example"
    ],
    "mode": "suggest",
    "version": 1
  }
}
```
