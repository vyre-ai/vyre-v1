# providers.own_people

Who runs on their own AI sign-ins: the people with a Mine provider and how many each, for the AI accounts switch (never an account name or a value)

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | ai.models |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/providers/own_people |
| MCP tool | providers_own_people (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  people: Array<{
      personId: string;
      accounts: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "people": [
      {
        "accounts": 1,
        "personId": "example"
      }
    ]
  }
}
```
