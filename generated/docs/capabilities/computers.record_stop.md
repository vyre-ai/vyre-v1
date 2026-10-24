# computers.record_stop

Stop recording; the recording is saved in work/recordings/ and one sheet asks what the agent should do with it

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.take_over |
| Grant level | use |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/record_stop |
| MCP tool | computers_record_stop (computer) |
| CLI | none |
| Emits | computer.recording_saved |

## Input

```ts
type In = {
  computerId: string;
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
    "computerId": "cmt_a1b2c3"
  },
  "output": {
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
    }
  }
}
```
