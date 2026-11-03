# sites.signin_link

A short-lived link that signs the person asking in to a Space-only site at its own address

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/signin_link |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  next?: string;
};
```

## Output

```ts
type Out = {
  url: string;
  expiresAt: number;
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
    "next": "example",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "url": "example"
  }
}
```
