# computers.stream

Live view source: WebRTC through the host, or MJPEG over the WebSocket as fallback; frames are live-only, never stored

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
| HTTP | POST /v1/computers/stream |
| MCP tool | computers_stream (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId: string;
};
```

## Output

```ts
type Out = {
  transport: "webrtc" | "mjpeg";
  url: string;
  ticket: string;
  expiresAt: number;
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
    "expiresAt": 1760000000000,
    "ticket": "example",
    "transport": "webrtc",
    "url": "example"
  }
}
```
