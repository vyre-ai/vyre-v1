# automations.preview_promote

Show what Promote to Space grants as an access diff, and which subscription keys must be replaced by shared API keys

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/preview_promote |
| MCP tool | automations_preview_promote (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
};
```

## Output

```ts
type Out = {
  diff: {
    grants: Array<{
        resource: string;
        level: "view" | "use" | "edit" | "manage";
        via: "owner_access" | "role" | "new_grant";
      }>;
    vaultNames: Array<string>;
    connections: Array<string>;
    keysToReplace: Array<{
        stepId: string;
        keyId: string;
        reason: string;
      }>;
  };
  ready: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3"
  },
  "output": {
    "diff": {
      "connections": [
        "example"
      ],
      "grants": [
        {
          "level": "view",
          "resource": "example",
          "via": "owner_access"
        }
      ],
      "keysToReplace": [
        {
          "keyId": "example",
          "reason": "example",
          "stepId": "example"
        }
      ],
      "vaultNames": [
        "example"
      ]
    },
    "ready": true
  }
}
```
