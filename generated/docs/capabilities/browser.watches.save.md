# browser.watches.save

Vyre for Chrome: watch a page or a region of one. It runs in the person's Chrome or on an agent's computer; a change is told in a chat with what it was and what it is now

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/browser/watches/save |
| MCP tool | none |
| CLI | none |
| Emits | browser.watch.saved |

## Input

```ts
type In = {
  watchId?: string;
  title: string;
  url: string;
  mode: "region" | "page";
  region?: {
    label: string;
    selector?: string;
  };
  everyMinutes: number;
  tell?: Array<string>;
  agentId?: string;
  runsOn: "computer" | "chrome";
  computerId?: string;
  paused?: boolean;
  value?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
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
    "agentId": "agt_a1b2c3",
    "computerId": "example",
    "everyMinutes": 5,
    "idempotencyKey": "idem_1",
    "mode": "region",
    "paused": true,
    "region": {
      "label": "Price",
      "selector": "example"
    },
    "runsOn": "computer",
    "tell": [
      "usr_a1b2c3"
    ],
    "title": "example",
    "url": "example",
    "value": "example",
    "watchId": "wch_a1b2c3"
  },
  "output": {
    "watch": {
      "agentId": "agt_a1b2c3",
      "changes": 1,
      "checkNow": true,
      "computerId": "example",
      "createdAt": 1760000000000,
      "error": "example",
      "everyMinutes": 5,
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
