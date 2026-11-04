# github.runner_release

The files of a release of the Actions runner with the checksum GitHub lists for each (public); the CI module checks its pinned checksum against it before any machine starts

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
| HTTP | POST /v1/github/runner_release |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  version: string;
};
```

## Output

```ts
type Out = {
  assets: Array<{
      name: string;
      digest: string | null;
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
    "version": "2.338.2"
  },
  "output": {
    "assets": [
      {
        "digest": "example",
        "name": "example"
      }
    ]
  }
}
```
