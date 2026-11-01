# gate.links.known

System: did the person give this link, or did a page already read in this chat link to it

| | |
|---|---|
| Module | gate |
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
| HTTP | POST /v1/gate/links/known |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  url: string;
  threads: Array<string>;
};
```

## Output

```ts
type Out = {
  known: boolean;
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
    "threads": [
      "thr_a1b2c3"
    ],
    "url": "example"
  },
  "output": {
    "known": true
  }
}
```
