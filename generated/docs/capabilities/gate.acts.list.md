# gate.acts.list

The ten Gate act kinds with risk, preview and who they apply to

| | |
|---|---|
| Module | gate |
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
| HTTP | POST /v1/gate/acts/list |
| MCP tool | gate_acts_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  acts: Array<{
      key: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
      title: string;
      risk: "low" | "medium" | "high";
      humanToo: boolean;
      peopleOnly: boolean;
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
    "acts": [
      {
        "humanToo": true,
        "key": "send",
        "peopleOnly": true,
        "risk": "low",
        "title": "example"
      }
    ]
  }
}
```
