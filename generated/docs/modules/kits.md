# Kits (kits)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (15)

- [kits.builder_open](../capabilities/kits.builder_open.md): Open the Kit builder chat with an agent (preview before publish)
- [kits.choose](../capabilities/kits.choose.md): Choose the Kit for the Space or for yourself
- [kits.denials](../capabilities/kits.denials.md): Sandbox denials with trace ids
- [kits.get](../capabilities/kits.get.md): Read one Kit
- [kits.health](../capabilities/kits.health.md): Kit health and debug panel: denials, failing tests, last run
- [kits.install](../capabilities/kits.install.md): Install a Kit after the sheet is confirmed
- [kits.install_sheet](../capabilities/kits.install_sheet.md): The install sheet: tools, record types, network domains, vault names
- [kits.list](../capabilities/kits.list.md): List Kits with channel and install state
- [kits.preview](../capabilities/kits.preview.md): Preview a Kit before applying it
- [kits.publish](../capabilities/kits.publish.md): Publish a Kit version; blocked on test failure, last good stays live
- [kits.restore_version](../capabilities/kits.restore_version.md): Restore an earlier Kit version
- [kits.rollback](../capabilities/kits.rollback.md): Roll a Kit back one click
- [kits.test_run](../capabilities/kits.test_run.md): Run the Kit tests against the seeded fixture Space
- [kits.update](../capabilities/kits.update.md): Update a Kit to a newer version of its channel
- [kits.versions](../capabilities/kits.versions.md): List Kit versions (One History)

## Events (6)

- [kit.installed](../events/kit.installed.md): A Kit was installed
- [kit.publish_blocked](../events/kit.publish_blocked.md): A Kit publish failed its tests; the last good version stays live
- [kit.published](../events/kit.published.md): A Kit version passed its tests on the seeded fixture Space and went live
- [kit.rolled_back](../events/kit.rolled_back.md): A Kit was rolled back in one click
- [kit.updated](../events/kit.updated.md): A Kit was updated
- [sandbox.denied](../events/sandbox.denied.md): A Kit script or connector call was denied in the sandbox
