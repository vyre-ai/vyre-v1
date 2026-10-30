# automations.validate

Check a definition against the step and trigger catalogue: missing inputs, unreachable steps, loops, personal triggers that need a Team Space

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
| HTTP | POST /v1/automations/validate |
| MCP tool | automations_validate (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  definition: {
    triggers: Array<{
        key: string;
        config?: Record<string, unknown>;
        filter?: unknown;
      }>;
    nodes: Array<{
        id: string;
        key: string;
        title?: string;
        input: Record<string, unknown>;
        next?: Array<string>;
        branches?: Array<{
            label: string;
            to: string;
            when?: string;
          }>;
        onError?: {
          mode: "fail" | "continue" | "retry" | "route" | "skip" | "substitute";
          max?: number;
          route?: string;
          codes?: Array<string>;
          output?: unknown;
        };
        ai?: {
          agentId?: string;
          keyId?: string;
          backupKeyId?: string;
          assigned?: {
            kind: "person" | "agent" | "group" | "role" | "automation";
            id: string;
          };
          reviewer?: {
            kind: "person" | "agent" | "group" | "role" | "automation";
            id: string;
          };
          approver?: {
            kind: "person" | "agent" | "group" | "role" | "automation";
            id: string;
          };
          timeoutMinutes?: number;
          nudgeMinutes?: number;
          escalateTo?: {
            kind: "person" | "agent" | "group" | "role" | "automation";
            id: string;
          };
        };
      }>;
    start?: Array<string>;
    allowSelfTrigger?: boolean;
  };
  kind?: "personal" | "space";
};
```

## Output

```ts
type Out = {
  ok: boolean;
  issues: Array<{
      nodeId?: string;
      severity: "error" | "warning";
      message: string;
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
  "input": {
    "definition": {
      "allowSelfTrigger": true,
      "nodes": [
        {
          "ai": {
            "agentId": "agt_a1b2c3",
            "approver": {
              "id": "usr_a1b2c3",
              "kind": "person"
            },
            "assigned": {
              "id": "usr_a1b2c3",
              "kind": "person"
            },
            "backupKeyId": "example",
            "escalateTo": {
              "id": "usr_a1b2c3",
              "kind": "person"
            },
            "keyId": "example",
            "nudgeMinutes": 1,
            "reviewer": {
              "id": "usr_a1b2c3",
              "kind": "person"
            },
            "timeoutMinutes": 1
          },
          "branches": [
            {
              "label": "example",
              "to": "example",
              "when": "example"
            }
          ],
          "id": "step_1",
          "input": {},
          "key": "records.update",
          "next": [
            "example"
          ],
          "onError": {
            "codes": [
              "example"
            ],
            "max": 1,
            "mode": "fail",
            "output": {},
            "route": "example"
          },
          "title": "example"
        }
      ],
      "start": [
        "example"
      ],
      "triggers": [
        {
          "config": {},
          "filter": {},
          "key": "record_change"
        }
      ]
    },
    "kind": "personal"
  },
  "output": {
    "issues": [
      {
        "message": "example",
        "nodeId": "example",
        "severity": "error"
      }
    ],
    "ok": true
  }
}
```
