# V1 Auth and Onboarding Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved 0.6.8-inspired auth/onboarding experience on top of v1 identity, invite, Space, and session contracts.

**Architecture:** Extend the existing `apps/app/src/join` state machine and primitives rather than copying the old runtime. A new welcome/Space-address state precedes the existing sign-in and invite states; a restrained halftone component is presentation-only and never owns auth state.

**Tech Stack:** React 19, React Native Web/Expo, TypeScript, v1 generated capability client, Node test runner, existing screenshot harness.

---

### Task 1: Add the welcome and Space connection state

**Files:**
- Modify: `apps/app/src/join/logic.ts`
- Modify: `apps/app/src/join/JoinFlow.tsx`
- Create: `apps/app/src/join/Welcome.tsx`
- Test: `apps/app/src/join/join.test.tsx`

- [ ] **Step 1: Write the failing state and render tests**

Add assertions that a fresh sign-in flow renders `Welcome back`, accepts an HTTPS Space address, rejects `tauri://localhost`, and advances to credentials only after `onResolveSpace(address)` returns a verified `JoinInvite`.

```tsx
const welcome = html({ stage: "connect" });
assert.match(welcome, /Welcome back/);
assert.match(welcome, /Space address/);
assert.doesNotMatch(welcome, /Sign in to tauri/);
assert.equal(normalizeSpaceAddress("acme.vyre.run"), "https://acme.vyre.run");
assert.equal(normalizeSpaceAddress("tauri:\/\/localhost"), null);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test apps/app/src/join/join.test.tsx`

Expected: FAIL because `connect`, `Welcome`, and `normalizeSpaceAddress` do not exist.

- [ ] **Step 3: Implement the smallest state transition**

Add `connect` to `Stage`, store `spaceAddress`, and add `space_resolved` / `space_failed` actions. Create `Welcome.tsx` with the Space field, Get started, and Sign in affordances. `JoinFlow` calls a new `onResolveSpace` prop and replaces its invite only after verification.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --import tsx --test apps/app/src/join/join.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/join/logic.ts apps/app/src/join/JoinFlow.tsx apps/app/src/join/Welcome.tsx apps/app/src/join/join.test.tsx changelog.md
git commit -m "feat: restore the Vyre welcome and Space connection flow"
```

### Task 2: Add the restrained auth-only halftone field

**Files:**
- Create: `apps/app/src/join/HalftoneField.tsx`
- Modify: `apps/app/src/join/kit.tsx`
- Modify: `apps/app/src/join/palette.ts`
- Test: `apps/app/src/join/join.test.tsx`

- [ ] **Step 1: Write failing presentation tests**

Assert the welcome renders one `auth-halftone`, form steps request the calm variant, reduced motion returns a static field, and no halftone marker appears in signed-in shell markup.

```tsx
assert.equal(welcome.match(/data-testid="auth-halftone"/g)?.length, 1);
assert.match(form, /data-intensity="calm"/);
assert.doesNotMatch(shell, /auth-halftone/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test apps/app/src/join/join.test.tsx`

Expected: FAIL because `HalftoneField` is absent.

- [ ] **Step 3: Implement a presentation-only field**

Create a web canvas with bounded dots, one animation frame loop, visibility pause, pointer response, and `prefers-reduced-motion` still rendering. Render it behind `JoinFrame`; use full intensity only for Welcome and a subdued opacity for form steps. Do not add auth state, network access, gradients, or glass panels.

- [ ] **Step 4: Run focused tests and a screenshot pass**

Run: `node --import tsx --test apps/app/src/join/join.test.tsx`

Run: `npm run shots -- --match join`

Expected: tests pass; desktop and phone auth screenshots contain no overflow or illegible text.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/join/HalftoneField.tsx apps/app/src/join/kit.tsx apps/app/src/join/palette.ts apps/app/src/join/join.test.tsx changelog.md
git commit -m "feat: add the restrained auth halftone field"
```

### Task 3: Apply the clean 0.6.8 form language and approved copy

**Files:**
- Modify: `apps/app/src/join/SignIn.tsx`
- Modify: `apps/app/src/join/AcceptInvite.tsx`
- Modify: `apps/app/src/join/ConnectAI.tsx`
- Modify: `apps/app/src/join/kit.tsx`
- Test: `apps/app/src/join/join.test.tsx`

- [ ] **Step 1: Write failing copy and interaction tests**

Assert the flow includes `Your space, your username and your password. That is all it takes, on any device.`, recovery-save enforcement, password visibility, GitHub/SSO separation, actionable errors, and 44px-or-larger touch rows at phone width.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test apps/app/src/join/join.test.tsx`

Expected: FAIL on the new copy and visibility control.

- [ ] **Step 3: Implement the approved 0.6.8 language**

Keep the current one-column `Group`, `Row`, `Bar`, and v1 state machine. Adjust typography/spacing to the committed 0.6.8 reference, add a local password visibility toggle, and adopt the approved polished-flow copy where it does not change the v1 contract.

- [ ] **Step 4: Verify desktop, phone, dark, light, and reduced-motion variants**

Run: `node --import tsx --test apps/app/src/join/join.test.tsx`

Run: `npm run shots -- --match join`

Expected: all variants pass visual bounds; no passkey appears in v1.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/join/SignIn.tsx apps/app/src/join/AcceptInvite.tsx apps/app/src/join/ConnectAI.tsx apps/app/src/join/kit.tsx apps/app/src/join/join.test.tsx changelog.md
git commit -m "feat: bring the 0.6.8 auth language into v1"
```

### Task 4: Wire verified Space resolution and onboarding projections

**Files:**
- Modify: `apps/app/src/shell/session/SessionGate.tsx`
- Modify: `apps/app/src/shell/session/stored.ts`
- Modify: `apps/app/src/join/Checklist.tsx`
- Test: `apps/app/src/shell/session/session.test.ts`
- Test: `apps/app/tests/shell.real.cmdk.test.tsx`
- Test: `apps/app/src/join/join.test.tsx`

- [ ] **Step 1: Write failing verification tests**

Prove the client does not write a session until `identity.whoami` and `spaces.get` succeed, a fingerprint mismatch refuses the session, and a 401 removes only the selected stored Space.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --import tsx --test apps/app/src/shell/session/session.test.ts apps/app/tests/shell.real.cmdk.test.tsx apps/app/src/join/join.test.tsx`

Expected: FAIL on connection-state and selected-Space assertions.

- [ ] **Step 3: Implement verification and projection-backed checklist rendering**

Resolve each address with anonymous `spaces.get`/invite preview as allowed, sign in using the selected base URL, call `openRealSession`, compare the returned Space definition/fingerprint, then persist. Feed checklist rows from `spaces.onboarding.*` results; never mark completion from local timers.

- [ ] **Step 4: Run focused tests and affected selection**

Run: `node --import tsx --test apps/app/src/shell/session/session.test.ts apps/app/tests/shell.real.cmdk.test.tsx apps/app/src/join/join.test.tsx`

Run: `npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/shell/session/SessionGate.tsx apps/app/src/shell/session/stored.ts apps/app/src/join/Checklist.tsx apps/app/src/shell/session/session.test.ts apps/app/tests/shell.real.cmdk.test.tsx apps/app/src/join/join.test.tsx changelog.md
git commit -m "feat: verify Spaces before persisting auth sessions"
```
