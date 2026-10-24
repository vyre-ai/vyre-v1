# telephony.sms.list

List texts for a number or contact

| | |
|---|---|
| Module | telephony |
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
| HTTP | POST /v1/telephony/sms/list |
| MCP tool | telephony_sms_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  numberId?: string;
  contactId?: string;
  direction?: "in" | "out";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  messages: Array<{
      id: string;
      numberId: string;
      direction: "in" | "out";
      from: string;
      to: string;
      body: string;
      status: "queued" | "sent" | "delivered" | "undelivered" | "failed" | "received";
      contactId?: string;
      mediaFileIds: Array<string>;
      campaignId?: string;
      at: number;
    }>;
  next?: string;
  total?: number;
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
    "contactId": "rec_a1b2c3",
    "cursor": "example",
    "direction": "in",
    "limit": 1,
    "numberId": "num_a1b2c3"
  },
  "output": {
    "messages": [
      {
        "at": 1760000000000,
        "body": "example",
        "campaignId": "cmp_a1b2c3",
        "contactId": "rec_a1b2c3",
        "direction": "in",
        "from": "example",
        "id": "sms_a1b2c3",
        "mediaFileIds": [
          "fil_a1b2c3"
        ],
        "numberId": "num_a1b2c3",
        "status": "queued",
        "to": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
