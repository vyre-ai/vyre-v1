# vault.fill

Fill a handle into a process at the last moment (env, request header, browser field, terminal) and scrub it from the output; the value stays in the filler

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | vault_item (/handle) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/fill |
| MCP tool | vault_fill (vault) |
| CLI | none |
| Emits | vault.used |

## Input

```ts
type In = {
  handle: string;
  target: {
    kind: "env" | "http_header" | "browser" | "terminal" | "file" | "git_credential" | "container_env" | "route_auth";
    ref: string;
  };
  returnValue?: boolean;
};
```

## Output

```ts
type Out = {
  filled: boolean;
  field: string;
  where: "device" | "host" | "computer";
  value?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "handle": "#Dana_Lawmatics.api_key",
    "returnValue": true,
    "target": {
      "kind": "env",
      "ref": "example"
    }
  },
  "output": {
    "field": "api_key",
    "filled": true,
    "value": "example",
    "where": "device"
  }
}
```
