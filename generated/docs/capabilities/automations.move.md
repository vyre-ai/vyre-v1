# automations.move

Move an Automation into a Group, or out with null

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/move |
| MCP tool | automations_move (automations) |
| CLI | none |
| Emits | automation.moved |

## Input

```ts
type In = {
  automationId: string;
  groupId: string | null;
};
```

## Output

```ts
type Out = {
  automation: {
    id: string;
    name: string;
    description?: string;
    kind: "personal" | "space";
    groupId?: string;
    ownerId: string;
    status: "on" | "off" | "draft" | "paused";
    pausedReason?: string;
    version: number;
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
    followers: Array<string>;
    alerts: {
      who: Array<{
          kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
          id: string;
        }>;
      when: {
        mode: "every" | "after_n";
        n?: number;
      };
      where: {
        needsYou: boolean;
        dm: boolean;
        channelId?: string;
      };
      escalation: Array<{
          to: {
            kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
            id: string;
          };
          afterHours: number;
        }>;
    };
    createdAt: number;
    updatedAt: number;
  };
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
    "automationId": "aut_a1b2c3",
    "groupId": "agr_a1b2c3"
  },
  "output": {
    "automation": {
      "alerts": {
        "escalation": [
          {
            "afterHours": 1,
            "to": {
              "id": "usr_a1b2c3",
              "kind": "person"
            }
          }
        ],
        "when": {
          "mode": "every",
          "n": 2
        },
        "where": {
          "channelId": "chn_a1b2c3",
          "dm": true,
          "needsYou": true
        },
        "who": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ]
      },
      "createdAt": 1760000000000,
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
      "description": "example",
      "followers": [
        "example"
      ],
      "groupId": "agr_a1b2c3",
      "id": "aut_a1b2c3",
      "kind": "personal",
      "name": "example",
      "ownerId": "example",
      "pausedReason": "example",
      "status": "on",
      "updatedAt": 1760000000000,
      "version": 1
    }
  }
}
```
