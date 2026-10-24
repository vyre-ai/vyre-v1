# ms.drive.share_item

Create a sharing link or invite people; Microsoft emails them

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/drive/share_item |
| MCP tool | ms_drive_share_item (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  driveId?: string;
  itemId: string;
  emails?: Array<string>;
  role: "read" | "write";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  shared: boolean;
  link?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "driveId": "example",
    "emails": [
      "maya@example.com"
    ],
    "idempotencyKey": "idem_1",
    "itemId": "example",
    "role": "read"
  },
  "output": {
    "link": "example",
    "shared": true
  }
}
```
