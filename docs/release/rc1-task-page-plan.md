# Shared task page

Implement the approved V1-SPEC 2.8 task page and existing tasks.page contract. Keep the current signed-in skin, shared rows and menus. The canonical page opens from Home, a Plan, a record or a copied link; the existing Needs you inbox remains its compact request preview.

One shared UI component displays title, summary, why, offered actions and source; Assigned, Reviewer and Approver; status, due and effort; working notes, linked records/files/dependencies and activity. Use existing request block rendering. Mutations use the existing task capabilities as the original person, await canonical readback, preserve failed drafts and refuse duplicate submits. Required action notes stay required. Status changes keep expectedFrom so stale decisions cannot silently overwrite another person's work. Group/role Take, release, snooze, follow and handover use their actual contracts.

Proof: route-input regression; shared page rendering/action validation; actual fresh-daemon task create, open, act/update, reload/deep link and history. Check phone overflow and a real screenshot. No new task primitive, permissions or automation engine.
