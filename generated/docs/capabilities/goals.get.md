# goals.get

One goal: its finish line and progress, the plan as tasks, who is helping, what waits on whom, budget used and the latest activity

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/get |
| MCP tool | goals_get (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  goalId: string;
};
```

## Output

```ts
type Out = {
  goal: {
    id: string;
    title: string;
    outcome?: string;
    finish: {
      kind: "number" | "checklist" | "owner";
      line: string;
      target?: number;
      direction?: "up" | "down";
      unit?: string;
      source?: {
        kind: "records" | "connection" | "mcp" | "automation" | "watch" | "manual";
        label?: string;
        type?: string;
        filter?: unknown;
        connector?: string;
        connectionId?: string;
        action?: string;
        input?: unknown;
        server?: string;
        tool?: string;
        automationId?: string;
        watchId?: string;
        path?: string;
      };
      items?: Array<{
          id: string;
          text: string;
          taskId?: string;
          done?: boolean;
        }>;
    };
    deadline: number;
    owner: string;
    leadAgentId: string;
    helpers: Array<{
        kind: "person" | "agent" | "group" | "role";
        id: string;
      }>;
    projectId?: string;
    recordIds: Array<string>;
    budget: {
      spendMicros?: number;
      turns?: number;
    };
    rhythm: {
      every: "day" | "hours" | "week";
      at?: string;
      hours?: number;
      day?: number;
    };
    zone: string;
    quiet: {
      from: string;
      to: string;
    } | null;
    permissions: Array<{
        act: "send" | "post" | "push_protected" | "site_promote" | "signature_send";
        target: string;
        label: string;
        granted?: boolean;
      }>;
    status: "draft" | "planning" | "active" | "waiting" | "stuck" | "paused" | "done" | "missed" | "stopped";
    statusReason?: string;
    threadId?: string;
    rootTaskId?: string;
    folderId?: string;
    progress: {
      value?: number;
      target?: number;
      start?: number;
      percent?: number;
      readAt?: number;
      error?: string;
      itemsDone?: number;
      items?: number;
      tasksDone: number;
      tasks: number;
    };
    nextCheckinAt?: number;
    lastCheckinAt?: number;
    checkins: number;
    spentMicros: number;
    turns: number;
    stuckAfter: number;
    endedAt?: number;
    ended?: "done" | "missed" | "stopped";
    summary?: string;
    retro?: {
      summary: string;
      worked: Array<string>;
      didNot: Array<string>;
      playbook?: string;
    };
    createdBy: string;
    createdAt: number;
    updatedAt: number;
  };
  tasks: Array<{
      taskId: string;
      key?: string;
      title: string;
      state: string;
      assigned?: {
        kind: "person" | "agent" | "group" | "role";
        id: string;
      };
      blocked: boolean;
    }>;
  waiting: Array<{
      taskId: string;
      kind: string;
      title: string;
      assigned?: {
        kind: "person" | "agent" | "group" | "role";
        id: string;
      };
      since: number;
    }>;
  activity: Array<{
      at: number;
      kind: string;
      text: string;
      by?: string;
      ref?: string;
    }>;
  readings: Array<{
      at: number;
      value?: number;
      ok: boolean;
      error?: string;
    }>;
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
    "goalId": "gol_a1b2c3"
  },
  "output": {
    "activity": [
      {
        "at": 1760000000000,
        "by": "example",
        "kind": "reading",
        "ref": "example",
        "text": "example"
      }
    ],
    "goal": {
      "budget": {
        "spendMicros": 1,
        "turns": 1
      },
      "checkins": 1,
      "createdAt": 1760000000000,
      "createdBy": "example",
      "deadline": 1760000000000,
      "ended": "done",
      "endedAt": 1760000000000,
      "finish": {
        "direction": "up",
        "items": [
          {
            "done": true,
            "id": "example",
            "taskId": "tsk_a1b2c3",
            "text": "example"
          }
        ],
        "kind": "number",
        "line": "Luma registrations for Lab 8 reach 300 by Friday",
        "source": {
          "action": "example",
          "automationId": "aut_a1b2c3",
          "connectionId": "con_a1b2c3",
          "connector": "hubspot",
          "filter": {},
          "input": {},
          "kind": "records",
          "label": "Luma, Lab 8 registrations",
          "path": "meta.total",
          "server": "example",
          "tool": "example",
          "type": "contact",
          "watchId": "wch_a1b2c3"
        },
        "target": 1,
        "unit": "registrations"
      },
      "folderId": "fld_a1b2c3",
      "helpers": [
        {
          "id": "agt_a1b2c3",
          "kind": "person"
        }
      ],
      "id": "gol_a1b2c3",
      "lastCheckinAt": 1760000000000,
      "leadAgentId": "agt_a1b2c3",
      "nextCheckinAt": 1760000000000,
      "outcome": "example",
      "owner": "usr_a1b2c3",
      "permissions": [
        {
          "act": "send",
          "granted": true,
          "label": "Send email from the Lab template",
          "target": "mail.send"
        }
      ],
      "progress": {
        "error": "example",
        "items": 1,
        "itemsDone": 1,
        "percent": 1,
        "readAt": 1760000000000,
        "start": 1,
        "target": 1,
        "tasks": 1,
        "tasksDone": 1,
        "value": 1
      },
      "projectId": "prj_a1b2c3",
      "quiet": {
        "from": "22:00",
        "to": "08:00"
      },
      "recordIds": [
        "rec_a1b2c3"
      ],
      "retro": {
        "didNot": [
          "example"
        ],
        "playbook": "example",
        "summary": "example",
        "worked": [
          "example"
        ]
      },
      "rhythm": {
        "at": "09:00",
        "day": 1,
        "every": "day",
        "hours": 1
      },
      "rootTaskId": "tsk_a1b2c3",
      "spentMicros": 1,
      "status": "draft",
      "statusReason": "example",
      "stuckAfter": 1,
      "summary": "example",
      "threadId": "thr_a1b2c3",
      "title": "example",
      "turns": 1,
      "updatedAt": 1760000000000,
      "zone": "Asia/Karachi"
    },
    "readings": [
      {
        "at": 1760000000000,
        "error": "example",
        "ok": true,
        "value": 1
      }
    ],
    "tasks": [
      {
        "assigned": {
          "id": "agt_a1b2c3",
          "kind": "person"
        },
        "blocked": true,
        "key": "example",
        "state": "example",
        "taskId": "tsk_a1b2c3",
        "title": "example"
      }
    ],
    "waiting": [
      {
        "assigned": {
          "id": "agt_a1b2c3",
          "kind": "person"
        },
        "kind": "example",
        "since": 1760000000000,
        "taskId": "tsk_a1b2c3",
        "title": "example"
      }
    ]
  }
}
```
