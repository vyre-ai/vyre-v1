# automations.watches.report

A check of a watched page: what it read now (or why it could not read). The first reading is the baseline; a different one is a change and is told in the watch's chat with before and after

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/watches/report |
| MCP tool | automations_watches_report (automations) |
| CLI | none |
| Emits | automations.watch.changed |

## Input

```ts
type In = {
  watchId: string;
  value?: string;
  error?: string;
};
```

## Output

```ts
type Out = {
  changed: boolean;
  watch: {
    watchId: string;
    title: string;
    url: string;
    host: string;
    mode: "region" | "page";
    region?: {
      label: string;
      selector?: string;
    };
    everyMinutes: number;
    tell: Array<string>;
    tellThreads: Array<string>;
    goalId?: string;
    agentId?: string;
    runsOn: "computer" | "chrome";
    computerId?: string;
    state: "on" | "paused" | "error";
    checkNow: boolean;
    value?: string;
    lastCheckedAt?: number;
    nextDueAt?: number;
    changes: number;
    lastChange?: {
      at: number;
      before: string;
      after: string;
    };
    threadId?: string;
    error?: string;
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
    "error": "example",
    "value": "example",
    "watchId": "wch_a1b2c3"
  },
  "output": {
    "changed": true,
    "watch": {
      "agentId": "agt_a1b2c3",
      "changes": 1,
      "checkNow": true,
      "computerId": "example",
      "createdAt": 1760000000000,
      "error": "example",
      "everyMinutes": 5,
      "goalId": "gol_a1b2c3",
      "host": "example",
      "lastChange": {
        "after": "example",
        "at": 1760000000000,
        "before": "example"
      },
      "lastCheckedAt": 1760000000000,
      "mode": "region",
      "nextDueAt": 1760000000000,
      "region": {
        "label": "Price",
        "selector": "example"
      },
      "runsOn": "computer",
      "state": "on",
      "tell": [
        "usr_a1b2c3"
      ],
      "tellThreads": [
        "thr_a1b2c3"
      ],
      "threadId": "thr_a1b2c3",
      "title": "example",
      "updatedAt": 1760000000000,
      "url": "example",
      "value": "example",
      "watchId": "wch_a1b2c3"
    }
  }
}
```
