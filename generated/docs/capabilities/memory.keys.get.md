# memory.keys.get

The account that pays for memory upkeep: yours for personal memory, and for an admin the Space's with the accounts it can be picked from and the keys picked for projects

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/keys/get |
| MCP tool | memory_keys_get (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  personal: {
    accountRef: string | null;
    choices: Array<{
        ref: string;
        title: string;
        provider: string;
        kind: "subscription" | "api_key" | "local_model";
        mine: boolean;
        state: string;
      }>;
  };
  admin: boolean;
  space?: {
    accountRef: string | null;
    choices: Array<{
        ref: string;
        title: string;
        provider: string;
        kind: "subscription" | "api_key" | "local_model";
        mine: boolean;
        state: string;
      }>;
  };
  projectKeys?: Record<string, string>;
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
    "admin": true,
    "personal": {
      "accountRef": "example",
      "choices": [
        {
          "kind": "subscription",
          "mine": true,
          "provider": "example",
          "ref": "#Team_Anthropic_Key",
          "state": "example",
          "title": "example"
        }
      ]
    },
    "projectKeys": {},
    "space": {
      "accountRef": "example",
      "choices": [
        {
          "kind": "subscription",
          "mine": true,
          "provider": "example",
          "ref": "#Team_Anthropic_Key",
          "state": "example",
          "title": "example"
        }
      ]
    }
  }
}
```
