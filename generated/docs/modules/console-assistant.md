# Console assistant (console-assistant)

Lane L7b. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (7)

- [console.assistant_context_set](../capabilities/console.assistant_context_set.md): Update the page context block as the person navigates
- [console.assistant_open](../capabilities/console.assistant_open.md): Open the Console assistant thread (kind console) with the current page as a context block
- [console.assistant_tools](../capabilities/console.assistant_tools.md): Engineer toolset available to this person: schema, connectors, settings, logs, traces, diagnostics, server config, filtered by role
- [console.diff_apply](../capabilities/console.diff_apply.md): Apply a proposed change as the person, with on-behalf-of audit; fixes target Space-owned objects as changesets approved by their Manage holders
- [console.diff_propose](../capabilities/console.diff_propose.md): Record a proposed change as a diff card (nothing is applied)
- [console.diff_reject](../capabilities/console.diff_reject.md): Reject a proposed change
- [console.explain_access](../capabilities/console.explain_access.md): Explain why a person can or cannot see a thing, in the words of the Access checker steps

## Events (3)

- [console.change_applied](../events/console.change_applied.md): A person applied a proposed change; the audit row reads on behalf of
- [console.change_proposed](../events/console.change_proposed.md): The Console assistant proposed a change as a diff card
- [console.change_rejected](../events/console.change_rejected.md): A person rejected a proposed change
