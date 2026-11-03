# home.away_digest

Write my While you were away digest for the time since I was last here: what my agents and routines did, changes on records I follow and the quiet notices that waited (an agent past its interrupt cap, a person who joined), by name. Writes nothing when nothing happened

| | |
|---|---|
| Module | home |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/home/away_digest |
| MCP tool | home_away_digest (meta) |
| CLI | none |
| Emits | digest.written |

## Input

```ts
type In = {
  since: number;
};
```

## Output

```ts
type Out = {
  digestId?: string;
  items: number;
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
    "since": 1760000000000
  },
  "output": {
    "digestId": "dgs_a1b2c3",
    "items": 1
  }
}
```
