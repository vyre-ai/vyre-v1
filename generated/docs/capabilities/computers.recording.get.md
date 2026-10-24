# computers.recording.get

Read one recording: events, network log and video paths (follows the folder access)

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/recording/get |
| MCP tool | computers_recording_get (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordingId: string;
};
```

## Output

```ts
type Out = {
  recording: {
    recordingId: string;
    computerId: string;
    agentId: string;
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    folderPath: string;
    state: "recording" | "saved" | "processed";
    intents: Array<string>;
  };
  eventsPath: string;
  harPath: string;
  videoPath: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "recordingId": "rcd_a1b2c3"
  },
  "output": {
    "eventsPath": "example",
    "harPath": "example",
    "recording": {
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
    },
    "videoPath": "example"
  }
}
```
