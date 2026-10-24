// Frozen props for ui/Softphone (spec 2.18, ARCH 7.3).
// One dock for every place. Cmd-Shift-K opens the dialer. Recording waits on consent.

import type { Density } from "../kit/types.ts";

export const SOFTPHONE_MODES = ["idle", "dialer", "incoming", "live", "held", "ended"] as const;

export type SoftphoneMode = (typeof SOFTPHONE_MODES)[number];

export interface SoftphoneNumber {
  id: string;
  label: string;
  num: string;
}

export interface SoftphoneCaller {
  name?: string;
  number: string;
  company?: string;
  recordId?: string;
}

export interface TransferTarget {
  name: string;
  kind: "teammate" | "agent";
}

export interface SoftphoneProps {
  open: boolean;
  mode: SoftphoneMode;
  density?: Density;
  numbers: readonly SoftphoneNumber[];
  fromId?: string;
  caller?: SoftphoneCaller;
  muted?: boolean;
  held?: boolean;
  recording?: boolean;
  /** True only after the announcement and the logged consent. */
  consent?: boolean;
  transferTargets?: readonly TransferTarget[];
  notes?: string;
  transcript?: readonly { who: string; text: string }[];
  summary?: string;
  onDial?: (number: string) => void;
  onAnswer?: () => void;
  onDecline?: () => void;
  onHangup?: () => void;
  onMute?: () => void;
  onHold?: () => void;
  onTransfer?: (name: string) => void;
  onRecord?: () => void;
  onLogTask?: (title: string) => void;
  onOpenRecord?: (recordId: string) => void;
}

export function softphoneLabel(props: SoftphoneProps): string {
  const name = props.caller?.name;
  if (name && name.length > 0) return name;
  if (props.caller) return props.caller.number;
  return "Softphone";
}
