# terminal.rules.get

Your allow, ask and deny rules and the folders the terminal is locked to

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
| HTTP | POST /v1/terminal/rules/get |
| MCP tool | terminal_rules_get (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  rules: {
    allow: Array<string>;
    ask: Array<string>;
    deny: Array<string>;
    folders: Array<string>;
  };
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
    "rules": {
      "allow": [
        "example"
      ],
      "ask": [
        "example"
      ],
      "deny": [
        "example"
      ],
      "folders": [
        "fld_a1b2c3"
      ]
    }
  }
}
```
