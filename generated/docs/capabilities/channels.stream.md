# channels.stream

The channel as a timeline: messages and Run items in order; repeated runs of one flow collapse into one row ("ran 6 times today"); counts feed the People, Agents and Runs menu

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/stream |
| MCP tool | channels_stream (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channelId: string;
  before?: number;
  limit?: number;
  show?: Array<"people" | "agents" | "runs">;
  expand?: Array<string>;
};
```

## Output

```ts
type Out = {
  items: Array<{
      kind: "message" | "run" | "run_group";
      at: number;
      messageId?: string;
      authorKind?: "person" | "agent" | "actor";
      runId?: string;
      runKind?: string;
      name?: string;
      status?: "queued" | "running" | "waiting" | "succeeded" | "failed" | "stopped";
      result?: string;
      durationMs?: number;
      groupKey?: string;
      count?: number;
      anyFailed?: boolean;
      runIds?: Array<string>;
    }>;
  counts: {
    people: number;
    agents: number;
    runs: number;
  };
  hidden: Array<"people" | "agents" | "runs">;
  hasMore: boolean;
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
    "before": 1,
    "channelId": "chn_a1b2c3",
    "expand": [
      "example"
    ],
    "limit": 1,
    "show": [
      "people"
    ]
  },
  "output": {
    "counts": {
      "agents": 1,
      "people": 1,
      "runs": 1
    },
    "hasMore": true,
    "hidden": [
      "people"
    ],
    "items": [
      {
        "anyFailed": true,
        "at": 1760000000000,
        "authorKind": "person",
        "count": 2,
        "durationMs": 1,
        "groupKey": "example",
        "kind": "message",
        "messageId": "msg_a1b2c3",
        "name": "example",
        "result": "example",
        "runId": "run_a1b2c3",
        "runIds": [
          "run_a1b2c3"
        ],
        "runKind": "automation",
        "status": "queued"
      }
    ]
  }
}
```
