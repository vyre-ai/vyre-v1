# sites.host

What this Space can host: its address, whether it is a phone address, and what a custom domain needs

| | |
|---|---|
| Module | sites |
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
| HTTP | POST /v1/sites/host |
| MCP tool | sites_host (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  origin?: string;
  relay: boolean;
  computers: boolean;
  domains: boolean;
  domainsNeed?: string;
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
    "computers": true,
    "domains": true,
    "domainsNeed": "example",
    "origin": "example",
    "relay": true
  }
}
```
