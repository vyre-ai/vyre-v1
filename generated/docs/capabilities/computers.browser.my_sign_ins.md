# computers.browser.my_sign_ins

The sites the browser profile your own turns of this agent use is signed in to, by site and when, never a value: a person who does not own a shared agent has a profile of their own on it. Nothing of another person's

| | |
|---|---|
| Module | computers |
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
| HTTP | POST /v1/computers/browser/my_sign_ins |
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
  profile: "own" | "agent";
  signIns: Array<{
      kind: "browser";
      site: string;
      signedInAs?: string;
      since: number;
      lastSeen: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
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
    "profile": "own",
    "signIns": [
      {
        "kind": "browser",
        "lastSeen": 1760000000000,
        "signedInAs": "example",
        "since": 1760000000000,
        "site": "app.example.com"
      }
    ]
  }
}
```
