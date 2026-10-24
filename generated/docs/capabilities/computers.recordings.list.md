# computers.recordings.list

Recordings stored in the agent folder

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/recordings/list |
| MCP tool | computers_recordings_list (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  recordings: Array<{
      recordingId: string;
      computerId: string;
      agentId: string;
      startedAt: number;
      endedAt?: number;
      durationMs?: number;
      folderPath: string;
      state: "recording" | "saved" | "processed";
      intents: Array<string>;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3",
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "recordings": [
      {
        "agentId": "agt_a1b2c3",
        "computerId": "cmt_a1b2c3",
        "durationMs": 1,
        "endedAt": 1760000000000,
        "folderPath": "work/recordings/rcd_a1b2c3",
        "intents": [
          "example"
        ],
        "recordingId": "rcd_a1b2c3",
        "startedAt": 1760000000000,
        "state": "recording"
      }
    ],
    "total": 1
  }
}
```
