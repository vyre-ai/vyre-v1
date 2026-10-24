# twilio.recording.download

Download a finished recording into a blob

| | |
|---|---|
| Module | twilio |
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
| HTTP | POST /v1/twilio/recording/download |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordingSid: string;
};
```

## Output

```ts
type Out = {
  blobId: string;
  size: number;
  durationSec?: number;
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
    "recordingSid": "example"
  },
  "output": {
    "blobId": "blb_a1b2c3",
    "durationSec": 1,
    "size": 1
  }
}
```
