# plugins.connections.policy

Who may add Space connections, and the allow-list that limits what anyone else may add

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/plugins/connections/policy |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  policy: {
    spaceAdders: "admins" | "managers";
    allowListOn: boolean;
    allowList: Array<string>;
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
    "policy": {
      "allowList": [
        "example"
      ],
      "allowListOn": true,
      "spaceAdders": "admins"
    }
  }
}
```
