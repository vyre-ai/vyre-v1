# memory.profile.context

The profile lines a turn loads, as the person who asked: their public part, their private part only when nobody else reads the chat, and the public part of the other people in it

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
| HTTP | POST /v1/memory/profile/context |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  audience: "private" | "shared";
  people: Array<{
      personId: string;
      self: boolean;
      basics: Array<string>;
      public: Array<string>;
      private: Array<string>;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "audience": "private",
    "people": [
      {
        "basics": [
          "example"
        ],
        "personId": "example",
        "private": [
          "example"
        ],
        "public": [
          "example"
        ],
        "self": true
      }
    ]
  }
}
```
