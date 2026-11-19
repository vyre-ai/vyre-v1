# plugins.connections.policy_set

Set who may add Space connections (admins, or whoever manages agents) and the allow-list (registry names, https hosts, packages) for everyone who is not an admin

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/connections/policy_set |
| MCP tool | none |
| CLI | none |
| Emits | plugin.connections_policy_changed |

## Input

```ts
type In = {
  spaceAdders?: "admins" | "managers";
  allowListOn?: boolean;
  allowList?: Array<string>;
  idempotencyKey: string;
};
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "allowList": [
      "example"
    ],
    "allowListOn": true,
    "idempotencyKey": "idem_1",
    "spaceAdders": "admins"
  },
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
