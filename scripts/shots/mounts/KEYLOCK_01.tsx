// Mount for lane l-backup (owner, 4 Nov): the lock that comes back while Vyre is open, after the Space server restarted and lost the person's key. One quiet line says why; Not now leaves their sign-ins
// closed and asks nothing more about this loss. The real LockScreen of apps/app/src/shell/session/KeyGate.tsx.
import type { ReactNode } from "react";
import { View } from "react-native";
import { LockScreen, MID_SESSION_LINE } from "../../../apps/app/src/shell/session/KeyGate.tsx";

export const title = "Mid-session lock";

const noop = async (): Promise<void> => undefined;

export default function Mount(): ReactNode {
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <LockScreen name="Irfad" sub={MID_SESSION_LINE} onUnlock={noop} onSkip={() => undefined} onForgot={() => undefined} onSignOut={() => undefined} />
    </View>
  );
}
