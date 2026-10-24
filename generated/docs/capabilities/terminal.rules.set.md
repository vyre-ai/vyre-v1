# terminal.rules.set

Change your allow, ask and deny rules and the extra folders (a Personal Space terminal is locked to its own folder plus these)

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | terminal.use |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/terminal/rules/set |
| MCP tool | terminal_rules_set (terminal) |
| CLI | none |
| Emits | terminal.rules_changed |

## Input

```ts
type In = {
  rules: {
    allow: Array<string>;
    ask: Array<string>;
    deny: Array<string>;
    folders: Array<string>;
  };
};
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
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
  },
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
