# sources.kinds

Source kinds a person can set up: connectors that declare sources plus the generic webhook

| | |
|---|---|
| Module | sources |
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
| HTTP | POST /v1/sources/kinds |
| MCP tool | sources_kinds (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  kinds: Array<{
      key: string;
      title: string;
      connector?: string;
      verify: "hmac" | "signature" | "none";
      needsTeamSpace: boolean;
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
    "kinds": [
      {
        "connector": "hubspot",
        "key": "example",
        "needsTeamSpace": true,
        "title": "example",
        "verify": "hmac"
      }
    ]
  }
}
```
