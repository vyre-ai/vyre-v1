# talk.disconnect

A person removes their own Talk key from the Vault

| | |
|---|---|
| Module | talk |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/talk/disconnect |
| MCP tool | none |
| CLI | none |
| Emits | talk.disconnected |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  on: boolean;
  provider: string;
  language: string;
  model: string;
  source: "own" | "space" | "none";
  spaceOn: boolean;
  mayManage: boolean;
  providers: Array<{
      key: string;
      name: string;
      keyUrl: string;
      models: Array<{
          id: string;
          label: string;
        }>;
      languages: Array<{
          id: string;
          label: string;
        }>;
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
    "language": "multi",
    "mayManage": true,
    "model": "nova-3",
    "on": true,
    "provider": "deepgram",
    "providers": [
      {
        "key": "deepgram",
        "keyUrl": "example",
        "languages": [
          {
            "id": "nova-3",
            "label": "example"
          }
        ],
        "models": [
          {
            "id": "nova-3",
            "label": "example"
          }
        ],
        "name": "example"
      }
    ],
    "source": "own",
    "spaceOn": true
  }
}
```
