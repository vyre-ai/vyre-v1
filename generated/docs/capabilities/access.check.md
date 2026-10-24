# access.check

Access checker: can principal P do action A on resource R, with each step in plain words

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | access.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/access/check |
| MCP tool | access_check (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  principal: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  actingFor?: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  action: {
    perm?: string;
    level: "view" | "use" | "edit" | "manage";
  };
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  fields?: Array<string>;
  provider?: string;
};
```

## Output

```ts
type Out = {
  decision: {
    effect: "allow" | "deny" | "hold";
    reason: string;
    steps: Array<{
        ok: boolean;
        text: string;
      }>;
    decisionId: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "actingFor": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "action": {
      "level": "view",
      "perm": "example"
    },
    "fields": [
      "example"
    ],
    "principal": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "provider": "example",
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "decision": {
      "decisionId": "example",
      "effect": "allow",
      "reason": "ok",
      "steps": [
        {
          "ok": true,
          "text": "example"
        }
      ]
    }
  }
}
```
