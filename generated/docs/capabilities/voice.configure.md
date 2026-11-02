# voice.configure

Change a person's Talk: on or off, provider, language, model. An agent may do this for the person it acts for. Keys go through voice_ask_key

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/voice/configure |
| MCP tool | voice_configure (meta, deferred) |
| CLI | none |
| Emits | voice.configured |

## Input

```ts
type In = {
  on?: boolean;
  provider?: string;
  language?: string;
  model?: string;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "language": "es",
    "model": "nova-3",
    "on": true,
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
