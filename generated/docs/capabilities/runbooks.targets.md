# runbooks.targets

Places the caller may run on: the server and the agent computers they can use

| | |
|---|---|
| Module | runbooks |
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
| HTTP | POST /v1/runbooks/targets |
| MCP tool | runbooks_targets (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  targets: Array<{
      target: {
        kind: "server" | "computer";
        computerId?: string;
      };
      name: string;
      online: boolean;
    }>;
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
    "targets": [
      {
        "name": "example",
        "online": true,
        "target": {
          "computerId": "cmt_a1b2c3",
          "kind": "server"
        }
      }
    ]
  }
}
```
