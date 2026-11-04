# github.me.usage

Where my GitHub was last used, by consumer (crew, CI, linked pull requests, agent tools): the Used by list

| | |
|---|---|
| Module | github |
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
| HTTP | POST /v1/github/me/usage |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  uses: Array<{
      consumer: string;
      repo: string;
      action: string;
      at: number;
    }>;
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
  "input": {},
  "output": {
    "uses": [
      {
        "action": "example",
        "at": 1760000000000,
        "consumer": "example",
        "repo": "vyre-ai/website"
      }
    ]
  }
}
```
