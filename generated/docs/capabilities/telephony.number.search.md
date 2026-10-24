# telephony.number.search

Search Twilio for numbers that can be bought

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | comms.numbers |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/number/search |
| MCP tool | telephony_number_search (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  country: string;
  areaCode?: string;
  contains?: string;
  capabilities?: Array<"voice" | "sms" | "mms">;
  limit?: number;
};
```

## Output

```ts
type Out = {
  available: Array<{
      e164: string;
      locality?: string;
      region?: string;
      capabilities: Array<string>;
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
  "input": {
    "areaCode": "example",
    "capabilities": [
      "voice"
    ],
    "contains": "example",
    "country": "US",
    "limit": 1
  },
  "output": {
    "available": [
      {
        "capabilities": [
          "example"
        ],
        "e164": "+14155550123",
        "locality": "example",
        "region": "example"
      }
    ]
  }
}
```
