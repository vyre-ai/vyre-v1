# terminal.risk

What a command can do before it runs: read-only, changes something or destructive, and what your rules say; red always asks

| | |
|---|---|
| Module | terminal |
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
| HTTP | POST /v1/terminal/risk |
| MCP tool | terminal_risk (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  command: string;
};
```

## Output

```ts
type Out = {
  risk: "read" | "change" | "danger";
  verdict: "deny" | "ask" | "allow" | "none";
  why: string;
  entry?: string;
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
    "command": "example"
  },
  "output": {
    "entry": "example",
    "risk": "read",
    "verdict": "deny",
    "why": "example"
  }
}
```
