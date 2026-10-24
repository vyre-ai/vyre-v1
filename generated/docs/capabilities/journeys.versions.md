# journeys.versions

List versions of a Journey definition

| | |
|---|---|
| Module | journeys |
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
| HTTP | POST /v1/journeys/versions |
| MCP tool | journeys_versions (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
};
```

## Output

```ts
type Out = {
  versions: Array<{
      versionId: string;
      n: number;
      by: string;
      at: number;
      reason?: string;
      name?: string;
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
  "input": {
    "journeyId": "jrn_a1b2c3"
  },
  "output": {
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "n": 1,
        "name": "example",
        "reason": "example",
        "versionId": "ver_a1b2c3"
      }
    ]
  }
}
```
