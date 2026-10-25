# kits.install_sheet

The install sheet: tools, record types, network domains, vault names, scripts, and the steps the sheet check found broken

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/install_sheet |
| MCP tool | kits_install_sheet (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId: string;
};
```

## Output

```ts
type Out = {
  sheet: {
    tools: Array<string>;
    recordTypes: Array<string>;
    networkDomains: Array<string>;
    vaultNames: Array<string>;
    scripts: number;
    problems: Array<{
        item: string;
        step: "apply" | "undo";
        cap: string;
        input: Record<string, unknown>;
        message: string;
      }>;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "kitId": "kit_a1b2c3"
  },
  "output": {
    "sheet": {
      "networkDomains": [
        "example"
      ],
      "problems": [
        {
          "cap": "example",
          "input": {},
          "item": "example",
          "message": "example",
          "step": "apply"
        }
      ],
      "recordTypes": [
        "example"
      ],
      "scripts": 1,
      "tools": [
        "example"
      ],
      "vaultNames": [
        "example"
      ]
    }
  }
}
```
