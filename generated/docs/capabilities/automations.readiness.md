# automations.readiness

What each Automation is missing before it can be turned on

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/readiness |
| MCP tool | automations_readiness (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId?: string;
  draft?: boolean;
};
```

## Output

```ts
type Out = {
  blocked: Array<{
      automationId?: string;
      nodeId?: string;
      short: string;
      line: string;
      button: "Connect" | "Fix";
      fix: {
        kind: "ai_account" | "mailbox" | "number" | "connection" | "file" | "step";
        connector?: string;
      };
    }>;
  sentence?: string;
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
    "automationId": "aut_a1b2c3",
    "draft": true
  },
  "output": {
    "blocked": [
      {
        "automationId": "aut_a1b2c3",
        "button": "Connect",
        "fix": {
          "connector": "example",
          "kind": "ai_account"
        },
        "line": "example",
        "nodeId": "example",
        "short": "example"
      }
    ],
    "sentence": "example"
  }
}
```
