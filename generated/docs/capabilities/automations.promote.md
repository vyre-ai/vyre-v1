# automations.promote

Promote a Personal Automation to the Space: keeps history and versions, runs on access granted to the automation itself

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.space |
| Grant level | manage |
| Risk | high |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/promote |
| MCP tool | automations_promote (automations) |
| CLI | none |
| Emits | automation.promoted |

## Input

```ts
type In = {
  automationId: string;
  confirm: true;
  ownerId?: string;
  replaceKeys?: Array<{
      stepId: string;
      keyId: string;
    }>;
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
            mode: "fail" | "continue" | "retry" | "route";
            max?: number;
            route?: string;
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3",
    "confirm": true,
    "ownerId": "example",
    "replaceKeys": [
      {
        "keyId": "example",
        "stepId": "example"
      }
    ]
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
              "max": 1,
              "mode": "fail",
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
    },
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
    }
  }
}
```
