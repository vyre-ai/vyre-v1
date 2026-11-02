# voice.connect

A person adds or replaces their own Talk key: it is checked with the provider at once, then kept in their Mine folder. A person does this, never an agent

| | |
|---|---|
| Module | voice |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/voice/connect |
| MCP tool | none |
| CLI | none |
| Emits | voice.connected |

## Input

```ts
type In = {
  provider: string;
  fields: Array<{
      key: string;
      value: string;
      secret?: boolean;
    }>;
  idempotencyKey: string;
};
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
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "fields": [
      {
        "key": "api_key",
        "secret": true,
        "value": "example"
      }
    ],
    "idempotencyKey": "idem_1",
    "provider": "deepgram"
  },
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
