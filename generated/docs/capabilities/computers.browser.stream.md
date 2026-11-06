# computers.browser.stream

Live view of an agent's browser, relayed by the Space: MJPEG or a WebSocket with a ticket that opens once, for one minute; frames are live-only, never stored. Wakes the browser

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
| Team Space only | no |
| HTTP | POST /v1/computers/browser/stream |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  transport: "mjpeg";
  url: string;
  ws?: string;
  width?: number;
  height?: number;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "height": 1,
    "transport": "mjpeg",
    "url": "example",
    "width": 1,
    "ws": "example"
  }
}
```
