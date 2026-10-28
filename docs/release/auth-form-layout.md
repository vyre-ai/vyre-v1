# Auth form parity

Approved scope: bring the non-Welcome form frame back to actual 0.6.8 structure while preserving the v1 flat, clean treatment. Welcome.tsx remains unchanged from PR761.

Reference: old apps/app/ui/components/FlowStep.tsx uses a content-height reading surface, small mark and Back at the top, progress before the content, and the primary below the fields. Old lib/theme/tokens.json sets readMax720. The old glass/blur treatment is deliberately excluded by the current approved auth design.

Implementation: shared Panel owns the reference header and progress; typed Bar slot owns the full-width primary beneath the existing Step content. Decorative app tiles are removed from the form bodies. Titles align with the fields. The username and password use full-width stacked inputs. Delayed Space metadata refreshes only the invite display data, preserving reducer state and in-flight sign-in. A host change remounts the flow; the SessionGate additionally keys by exact origin, scopes cached discovery to that origin, and ignores completion from an old address. Verification and provider contracts stay unchanged.

Validation plan: existing form/state tests plus a DOM-order regression, normal production export and real booted-daemon browser acceptance. The browser checks content height, primary/column geometry, phone horizontal overflow, and captures desktop light/dark and phone screenshots after discarding the synthetic regression input. It also delays sign-in options while typing/submitting to prove metadata arrival preserves username, password, stage and submission state.
