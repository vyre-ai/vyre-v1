# journeys.to_pipeline

Move a Journey onto its subject type as a pipeline; run again after a stop, nothing is deleted

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | journeys.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/journeys/to_pipeline |
| MCP tool | none |
| CLI | none |
| Emits | journey.designed |

## Input

```ts
type In = {
  journeyId: string;
  stageField?: string;
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
        makesProject?: boolean;
      }>;
    startRule?: {
      event: string;
      filter?: unknown;
      enabled: boolean;
    };
    startAutomationId?: string;
    mode?: "subject" | "migrating" | "pipeline";
    stageField?: string;
    variables?: Array<{
        key: string;
        title: string;
      }>;
    legacyType?: string;
    migrateNote?: string;
    inFlight: number;
    createdAt: number;
    updatedAt: number;
  };
  total: number;
  done: number;
  failed: Array<{
      recordId: string;
      error: string;
    }>;
  finished: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "journeyId": "jrn_a1b2c3",
    "stageField": "example"
  },
  "output": {
    "done": 1,
    "failed": [
      {
        "error": "example",
        "recordId": "rec_a1b2c3"
      }
    ],
    "finished": true,
    "journey": {
      "createdAt": 1760000000000,
      "id": "jrn_a1b2c3",
      "inFlight": 1,
      "legacyType": "contact",
      "migrateNote": "example",
      "mode": "subject",
      "name": "example",
      "recordType": "contact",
      "stageField": "example",
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
          "makesProject": true,
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
      "variables": [
        {
          "key": "example",
          "title": "example"
        }
      ],
      "version": 1
    },
    "total": 1
  }
}
```
