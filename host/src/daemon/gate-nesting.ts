// One approval covers one send (spec 2.14, 4.6). mail.send is the only door for sending: it carries the Gate (an agent's send is held for a person to approve), and while it runs it calls the
// provider backend (resend.send_email, mailgun.send_email, google.gmail.send_message, ms.mail.send_message), each of which also declares `gate: send`. Without this wrapper the approved
// send would be parked a second time at its inner provider call, and the person would be asked twice for one email.
//
// The pipeline records, on every call a handler makes (ctx.call), the Gate acts the handler's own capability already settled (CtxSeed.clearedActs). A handler runs only after its Gate
// cleared (an approval for exactly this payload, or no Gate applied to this caller), so a nested call whose capability needs the same act is already covered. This wrapper turns that
// into the Gate hook's answer. Everything else is the real hook's: a top-level call to a provider backend (no ancestor cleared the act) is still held, verify is untouched, and a call that
// reaches the provider with a different act (delete, spend) is still asked.
import type { GateHook } from "../invoke.ts";

/** Wrap the Space's Gate hook so a call nested inside an already cleared call of the same act is never parked again. */
export function withGateNesting(inner: GateHook): GateHook {
  return {
    applies(cap, input, seed) {
      const act = cap.gate?.act;
      if (act && act !== "none" && seed.clearedActs?.includes(act)) return null;
      return inner.applies(cap, input, seed);
    },
    park: (a) => inner.park(a),
    verify: (token, a) => inner.verify(token, a),
    ...(inner.resume ? { resume: (a) => inner.resume!(a) } : {}),
  };
}
