# computers.chrome.screenshot

Screenshot of the tab or one element, stored in the agent folder and rendered as a screenshot block

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.use |
| Grant level | view |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/chrome/screenshot |
| MCP tool | chrome_screenshot (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  ref?: string;
  fullPage?: boolean;
};
```

## Output

```ts
type Out = {
  fileId: string;
  width: number;
  height: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- timeout.deadline
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3",
    "fullPage": true,
    "ref": "e12",
    "tabId": "example"
  },
  "output": {
    "fileId": "fil_a1b2c3",
    "height": 1,
    "width": 1
  }
}
```
