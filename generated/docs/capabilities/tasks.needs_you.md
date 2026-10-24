# tasks.needs_you

Needs you: my Ready tasks of kind Approve, Review, Answer or Unblock, plus due today, overdue or blocking others

| | |
|---|---|
| Module | tasks |
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
| HTTP | POST /v1/tasks/needs_you |
| MCP tool | tasks_needs_you (tasks) |
| CLI | vyre tasks needs-you |
| Emits | none |

## Input

```ts
type In = {
  limit?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
      task: {
        id: string;
        kind: "work" | "approve" | "review" | "answer" | "unblock" | "signature";
        title: string;
        summary?: string;
        why?: string;
        state: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
        blocked: boolean;
        blocks: Array<{
            type: string;
            v?: number;
            data: unknown;
          }>;
        actions: Array<{
            key: string;
            label: string;
            note?: "required" | "optional";
          }>;
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
        takenBy?: string;
        due?: number;
        effort?: number;
        recordId?: string;
        fileIds: Array<string>;
        source?: {
          kind: "chat" | "run" | "gate" | "journey" | "manual";
          id: string;
        };
        parentTaskId?: string;
        dependsOn: Array<string>;
        followers: Array<string>;
        workingNotes: Record<string, string>;
        threadId?: string;
        reviewLoops: number;
        snoozedUntil?: number;
        createdBy: string;
        createdAt: number;
        updatedAt: number;
      };
      reason: "ready" | "due_today" | "overdue" | "blocking";
      handledBy?: string;
    }>;
  total: number;
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
    "limit": 1
  },
  "output": {
    "items": [
      {
        "handledBy": "example",
        "reason": "ready",
        "task": {
          "actions": [
            {
              "key": "approve",
              "label": "Approve",
              "note": "required"
            }
          ],
          "approver": {
            "id": "usr_a1b2c3",
            "kind": "person"
          },
          "assigned": {
            "id": "usr_a1b2c3",
            "kind": "person"
          },
          "blocked": true,
          "blocks": [
            {
              "data": {},
              "type": "record_card",
              "v": 1
            }
          ],
          "createdAt": 1760000000000,
          "createdBy": "example",
          "dependsOn": [
            "tsk_a1b2c3"
          ],
          "due": 1760000000000,
          "effort": 1,
          "fileIds": [
            "fil_a1b2c3"
          ],
          "followers": [
            "example"
          ],
          "id": "tsk_a1b2c3",
          "kind": "work",
          "parentTaskId": "tsk_a1b2c3",
          "recordId": "rec_a1b2c3",
          "reviewLoops": 1,
          "reviewer": {
            "id": "usr_a1b2c3",
            "kind": "person"
          },
          "snoozedUntil": 1760000000000,
          "source": {
            "id": "run_a1b2c3",
            "kind": "chat"
          },
          "state": "todo",
          "summary": "example",
          "takenBy": "usr_a1b2c3",
          "threadId": "thr_a1b2c3",
          "title": "example",
          "updatedAt": 1760000000000,
          "why": "example",
          "workingNotes": {}
        }
      }
    ],
    "total": 1
  }
}
```
