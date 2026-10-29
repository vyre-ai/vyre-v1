# Production multi-Space switching checkpoint

Owner agent auth068_completion. Reused checkout `/Users/irfad/Claude/Orgs/Vyre/v1-wt/rc1-auth068-completion`, branch `codex/rc1-multi-space-switch`, base exact root72dc0a998fbaccf8572e17acd30659970bb05ecf. Root owns recovery code contract and ONLY SignIn recovery-help branch/imports; do not overwrite those when integrating SessionGate hunks. No schema/gen changes in this lane.

Mandatory: actual persisted server sessions, per-Space tabs/principal/session/runtime isolation, verified target ID+principal+continuity, old runtime/socket close, target401/manualsignout does not clear others. Global Lock Vyre remains global and clears all profiles; lead explicitly rejected a bypass through a retained profile. Ordinary browser cross-origin activation navigates to the other actual origin, never forwards token or loosens CORS. Native packaged origin retains one app and opens each actual target baseUrl/token.

Architecture implemented but uncommitted:
- stored.readStoredSessions returns complete validated endpoint/card hints only; verifyStoredSession additionally rejects a cached principal ID mismatch and closes that session.
- new space-catalog.ts supplies deduped catalogue, existing per-device/person/Space tab restoration and token-free activation URLs; personal saved skin metadata is namespaced per person+Space.
- ShellHub accepts optional personIds per Space for real identity-specific tab storage.
- Production Shell accepts onSwitchSpace callback; sample hub fallback unchanged. SessionGate activates actual saved target, restores its URL/tab route before keyed ShellHost remount. Old real session effect cleanup closes link, timers and hooks. Target rendering is identity/baseUrl guarded.
- Existing Personal ensure/resume bridge handles changing loopback port. Add/join still uses existing canonical flows. Ordinary web cross-origin selection navigates rather than bypassing backend CORS.
- SessionHost passes metadata cards only to runtime/settings; Settings Space rows can select the actual target. Phone You lists other saved Space cards; phone navigation also updates hub/tab URL state.
- new space-theme.ts uses existing theme controller, scoped appearance store, and actual server defaults/settings Kit choice. Theme code stays in the post-auth ShellHost chunk, not eager SessionGate. Session open reads existing settings.kit.get in parallel and real Space defaults.skin; Personal Kit stays Personal. Skin selection now uses real controller and persists per identity/Space.

Evidence so far:
- Real TDD red `/tmp/vyre-space-switch-red.log`: two distinct real daemon IDs/claims + production artifact at literal `https://tauri.localhost`, only static assets fulfilled locally; actual HTTP/socket transport untouched, strict production CORS works. Second Space menu entry absent before change.
- First real slice `/tmp/vyre-space-switch-green1.log`3/3 passed: both real menu entries and actual target activation at fixed packaged origin. This is NOT the full signoff.
- Four focused files green `/tmp/vyre-multispace-focused3.log` (catalogue, real session, phone, pure hub).
- Owned semantic check shows only two pre-existing diagnostics in session.ts deferredModules/stored.ts optional continuity; no new diagnostics. `/tmp/vyre-multispace-semantic2.log`.
- Five touched UI files lint zero `/tmp/vyre-multispace-lint.log`.
- Latest exact export `/tmp/vyre-multispace-web2`, `/tmp/vyre-multispace-export2.log`. No exports in parallel; always serial lock.
- Full actual live test running `/tmp/vyre-space-switch-full1.log`, exec session65418. Test file apps/app/tests/spaces.switch.live.test.ts. It now covers actual files unique to each real Space, target bearer isolation, old close evidence, per-Space route/tab return, actual Graphite default, phone switching, target token revocation + Back, rejoin, and global lock URL bypass refusal. Last test edit adds wait for actual B metadata skin persistence after reload, so rerun may be needed even if the in-flight attempt failed that timing.

Next: inspect full1 result/DOM; diagnose exact defects without API mocks, widen tests only for uncovered behaviors. Re-export only on source changes. Do not commit/claim full completion before actual comprehensive green and auth/release regression. Update changelog+Simba memory before commit. Root will integrate SessionGate around its independent Recovery branch.

## Final production switching proof

- Source artifact `/tmp/vyre-multispace-web4`; real combined browser `/tmp/vyre-space-switch-full10.log`: **3/3 passed**, 24.97 seconds (includes two harness checks and one full lifecycle).
- Two separately claimed real daemons, real personal/team identity sessions, private Files per server. Packaged static artifact is served at exact `https://tauri.localhost`; its actual HTTP/WebSocket calls reach loopback daemons. Chrome gets explicit `local-network-access` permission for that origin. This is browser acceptance, not a signed native IPC/package acceptance claim.
- Desktop and phone switching restore actual private-file tabs; each server receives only its own bearer. Actual Space default Graphite survives hydration. Revoking Team while on Personal clears only Team; Back restores Personal. Add/join signs back into Team without clearing Personal. Global Lock deletes all saved sessions; direct URL cannot bypass it.
- Observed real hello frames and real socket-close events for in-document switches. The initial socket from a full document navigation is excluded from Playwright close-event assertions because the old frame's close event is not delivered to the new document. Newly opened Personal sockets all close when switching back to Team.
- Fixed runtime reopen loop from changing sign-out callbacks, and pending hello transports that remained open until timeout. Connected WebSocket transport now owns closure after dial handoff.
- Focused session/phone/Space tests **64/64**, connection lifecycle suites **20/20**, transport ownership **1/1**. Strict owned-source diagnostics **0**. Actual captures: `/Users/irfad/Downloads/Vyre-v1-RC-screens/multi-space/team-restored-tabs.png`, `phone-team-restored.png`.
- Separate existing gap: production daemon still emits legacy top-level `hello_ok` instead of the existing modern Sync hub envelope. Modern sync integration must be reviewed separately; this proof does not claim modern scoped replication or call the Synced badge sufficient evidence.
