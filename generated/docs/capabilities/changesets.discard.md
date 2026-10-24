# changesets.discard

Throw the staged changes away

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/changesets/discard |
| MCP tool | changesets_discard (files) |
| CLI | none |
| Emits | changeset.discarded |

## Input

```ts
type In = {
  changesetId: string;
};
```

## Output

```ts
type Out = {
  discarded: boolean;
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
    "changesetId": "chg_a1b2c3"
  },
  "output": {
    "discarded": true
  }
}
```
