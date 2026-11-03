# goals.plan

Add tasks to the plan of a goal: each with its brief, what done means, who does it (an agent, a person, a group) and what it waits on. They are tasks like any other and show "Part of" the goal

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/plan |
| MCP tool | goals_plan_update (tasks) |
| CLI | none |
| Emits | goal.created, goal.started, goal.updated, goal.status_changed, goal.progress, goal.woken, goal.resumed, goal.reported, goal.step_done, goal.budget_warned, goal.ended, goal.extended |

## Input

```ts
type In = {
  goalId: string;
  children: Array<{
      key: string;
      title: string;
      why: string;
      impact?: string;
      brief?: string;
      doneMeans?: Array<string>;
      assigned: {
        kind: "person" | "agent" | "group" | "role";
        id: string;
      };
      reviewer?: {
        kind: "person" | "agent" | "group" | "role";
        id: string;
      };
      approver?: {
        kind: "person" | "agent" | "group" | "role";
        id: string;
      };
      dependsOn?: Array<string>;
      due?: number;
    }>;
};
```

## Output

```ts
type Out = {
  tasks: Array<{
      key: string;
      taskId: string;
      created: boolean;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "children": [
      {
        "approver": {
          "id": "agt_a1b2c3",
          "kind": "person"
        },
        "assigned": {
          "id": "agt_a1b2c3",
          "kind": "person"
        },
        "brief": "example",
        "dependsOn": [
          "example"
        ],
        "doneMeans": [
          "example"
        ],
        "due": 1760000000000,
        "impact": "+40 to +60 registrations",
        "key": "reminder",
        "reviewer": {
          "id": "agt_a1b2c3",
          "kind": "person"
        },
        "title": "example",
        "why": "Lab 7 attendees registered at 31% after one reminder last time"
      }
    ],
    "goalId": "gol_a1b2c3"
  },
  "output": {
    "tasks": [
      {
        "created": true,
        "key": "example",
        "taskId": "tsk_a1b2c3"
      }
    ]
  }
}
```
