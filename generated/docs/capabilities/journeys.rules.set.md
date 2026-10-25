# journeys.rules.set

Set the exit rule and time limit of one stage

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | journeys.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/rules/set |
| MCP tool | journeys_rules_set (automations) |
| CLI | none |
| Emits | journey.designed |

## Input

```ts
type In = {
  journeyId: string;
  stageKey: string;
  exit?: {
    requireTasks: boolean;
    manualOnly?: boolean;
  };
  timeLimit?: ({
    hours: number;
    escalateTo?: {
      kind: "role" | "person";
      id: string;
    };
  }) | null;
};
```

## Output

```ts
type Out = {
  journey: {
    id: string;
    name: string;
    subjectType: string;
    recordType: string;
    version: number;
    stages: Array<{
        key: string;
        title: string;
        order: number;
        exit: {
          requireTasks: boolean;
          manualOnly?: boolean;
        };
        timeLimit?: {
          hours: number;
          escalateTo?: {
            kind: "role" | "person";
            id: string;
          };
        };
        tasks: Array<{
            key: string;
            title: string;
            description?: string;
            kind?: "work" | "approve" | "review" | "answer" | "unblock" | "signature";
            assigned: {
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
            required: boolean;
            dueAfterHours?: number;
            keyId?: string;
            backupKeyId?: string;
            doneByAutomation?: string;
          }>;
        automations: Array<string>;
        final?: boolean;
        onLeaving?: Array<string>;
      }>;
    startRule?: {
      event: string;
      filter?: unknown;
      enabled: boolean;
    };
    startAutomationId?: string;
    inFlight: number;
    createdAt: number;
    updatedAt: number;
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
    "exit": {
      "manualOnly": true,
      "requireTasks": true
    },
    "journeyId": "jrn_a1b2c3",
    "stageKey": "intake",
    "timeLimit": {
      "escalateTo": {
        "id": "example",
        "kind": "role"
      },
      "hours": 1
    }
  },
  "output": {
    "journey": {
      "createdAt": 1760000000000,
      "id": "jrn_a1b2c3",
      "inFlight": 1,
      "name": "example",
      "recordType": "contact",
      "stages": [
        {
          "automations": [
            "aut_a1b2c3"
          ],
          "exit": {
            "manualOnly": true,
            "requireTasks": true
          },
          "final": true,
          "key": "intake",
          "onLeaving": [
            "aut_a1b2c3"
          ],
          "order": 1,
          "tasks": [
            {
              "approver": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "assigned": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "backupKeyId": "example",
              "description": "example",
              "doneByAutomation": "aut_a1b2c3",
              "dueAfterHours": 1,
              "key": "collect_documents",
              "keyId": "example",
              "kind": "work",
              "required": true,
              "reviewer": {
                "id": "usr_a1b2c3",
                "kind": "person"
              },
              "title": "example"
            }
          ],
          "timeLimit": {
            "escalateTo": {
              "id": "example",
              "kind": "role"
            },
            "hours": 1
          },
          "title": "example"
        }
      ],
      "startAutomationId": "aut_a1b2c3",
      "startRule": {
        "enabled": true,
        "event": "record.created",
        "filter": {}
      },
      "subjectType": "contact",
      "updatedAt": 1760000000000,
      "version": 1
    }
  }
}
```
