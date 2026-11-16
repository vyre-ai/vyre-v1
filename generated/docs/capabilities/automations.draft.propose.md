# automations.draft.propose

An Assistant puts steps on the page as a proposal for a person to accept: nothing is saved as the definition, made live or turned on. With no automationId an empty Automation that is off is made first

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.personal |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/draft/propose |
| MCP tool | automations_draft_propose (automations) |
| CLI | none |
| Emits | automation.created, automation.updated |

## Input

```ts
type In = {
  automationId?: string;
  name?: string;
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
          mode?: "answer" | "task";
          doneMeans?: Array<string>;
        };
        askBeforeSending?: boolean;
      }>;
    start?: Array<string>;
    allowSelfTrigger?: boolean;
    ai?: {
      keyId?: string;
      backupKeyId?: string;
    };
  };
  summary: string;
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
            mode?: "answer" | "task";
            doneMeans?: Array<string>;
          };
          askBeforeSending?: boolean;
        }>;
      start?: Array<string>;
      allowSelfTrigger?: boolean;
      ai?: {
        keyId?: string;
        backupKeyId?: string;
      };
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
    runsAs?: string;
  };
  draft?: {
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
            mode?: "answer" | "task";
            doneMeans?: Array<string>;
          };
          askBeforeSending?: boolean;
        }>;
      start?: Array<string>;
      allowSelfTrigger?: boolean;
      ai?: {
        keyId?: string;
        backupKeyId?: string;
      };
    };
    rev: number;
    baseVersion: number;
    by: string;
    at: number;
  };
  proposal?: {
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
            mode?: "answer" | "task";
            doneMeans?: Array<string>;
          };
          askBeforeSending?: boolean;
        }>;
      start?: Array<string>;
      allowSelfTrigger?: boolean;
      ai?: {
        keyId?: string;
        backupKeyId?: string;
      };
    };
    summary: string;
    by: string;
    for: string;
    baseVersion: number;
    at: number;
    steps: number;
  };
  ok: boolean;
  issues: Array<unknown>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3",
    "definition": {
      "ai": {
        "backupKeyId": "example",
        "keyId": "example"
      },
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
            "doneMeans": [
              "example"
            ],
            "escalateTo": {
              "id": "usr_a1b2c3",
              "kind": "person"
            },
            "keyId": "example",
            "mode": "answer",
            "nudgeMinutes": 1,
            "reviewer": {
              "id": "usr_a1b2c3",
              "kind": "person"
            },
            "timeoutMinutes": 1
          },
          "askBeforeSending": true,
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
    "name": "example",
    "summary": "example"
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
        "ai": {
          "backupKeyId": "example",
          "keyId": "example"
        },
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
              "doneMeans": [
                "example"
              ],
              "escalateTo": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "keyId": "example",
              "mode": "answer",
              "nudgeMinutes": 1,
              "reviewer": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "timeoutMinutes": 1
            },
            "askBeforeSending": true,
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
      "runsAs": "usr_a1b2c3",
      "status": "on",
      "updatedAt": 1760000000000,
      "version": 1
    },
    "draft": {
      "at": 1,
      "baseVersion": 1,
      "by": "example",
      "definition": {
        "ai": {
          "backupKeyId": "example",
          "keyId": "example"
        },
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
              "doneMeans": [
                "example"
              ],
              "escalateTo": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "keyId": "example",
              "mode": "answer",
              "nudgeMinutes": 1,
              "reviewer": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "timeoutMinutes": 1
            },
            "askBeforeSending": true,
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
      "rev": 1
    },
    "issues": [
      {}
    ],
    "ok": true,
    "proposal": {
      "at": 1,
      "baseVersion": 1,
      "by": "example",
      "definition": {
        "ai": {
          "backupKeyId": "example",
          "keyId": "example"
        },
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
              "doneMeans": [
                "example"
              ],
              "escalateTo": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "keyId": "example",
              "mode": "answer",
              "nudgeMinutes": 1,
              "reviewer": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "timeoutMinutes": 1
            },
            "askBeforeSending": true,
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
      "for": "example",
      "steps": 1,
      "summary": "example"
    }
  }
}
```
