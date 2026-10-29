# memory.meaning.status

Whether meaning search is on, which model it uses, how many documents have a vector and, when it is not, a plain reason (not set up reads healthy)

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/meaning/status |
| MCP tool | memory_meaning_status (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  mode: "local" | "key" | "off";
  state: "on" | "loading" | "not_set_up" | "degraded" | "off";
  model?: string;
  hint?: string;
  indexed: number;
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
    "hint": "example",
    "indexed": 1,
    "mode": "local",
    "model": "example",
    "state": "on"
  }
}
```
