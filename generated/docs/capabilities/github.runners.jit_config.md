# github.runners.jit_config

Make a just-in-time runner for one job: GitHub answers a config the new machine runs with, once. Called by the CI module; the config is never stored

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/runners/jit_config |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  name: string;
  labels: Array<string>;
  installationId?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runnerId: number;
  jitConfig: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "installationId": 1,
    "labels": [
      "example"
    ],
    "name": "example",
    "repo": "vyre-ai/website"
  },
  "output": {
    "jitConfig": "example",
    "runnerId": 1
  }
}
```
