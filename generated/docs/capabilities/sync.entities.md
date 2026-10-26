# sync.entities

Replica entities, schema versions and the window profile per device class (drives hello and the replica DDL)

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/entities |
| MCP tool | sync_entities (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  deviceClass?: "desktop" | "phone" | "web";
};
```

## Output

```ts
type Out = {
  entities: Array<{
      entity: string;
      version: number;
      profile: "all" | "window" | "none";
      windowDays?: number;
    }>;
  registryHash: string;
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
    "deviceClass": "desktop"
  },
  "output": {
    "entities": [
      {
        "entity": "example",
        "profile": "all",
        "version": 1,
        "windowDays": 1
      }
    ],
    "registryHash": "example"
  }
}
```
