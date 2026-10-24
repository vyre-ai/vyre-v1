// Frozen props for the empty, offline and error states (spec 3.0).
// Empty and offline: one line and one primary action.
// Error: what, why, next, trace id, plus Retry, Copy trace id, and Report a problem.

export const STATE_ICONS = ["inbox", "search", "files", "records", "chat", "offline", "error", "done"] as const;

export type StateIcon = (typeof STATE_ICONS)[number];

export interface StateAction {
  label: string;
  onPress: () => void;
}

export interface EmptyProps {
  kind: "empty";
  title: string;
  icon?: StateIcon;
  action?: StateAction;
}

export interface OfflineProps {
  kind: "offline";
  title: string;
  icon?: StateIcon;
  action?: StateAction;
}

export interface ErrorProps {
  kind: "error";
  message: string;
  code?: string;
  cause?: string;
  next?: string;
  retryable?: boolean;
  traceId?: string;
  onRetry?: () => void;
}

export type StateProps = EmptyProps | OfflineProps | ErrorProps;

export function stateLabel(props: StateProps): string {
  return props.kind === "error" ? props.message : props.title;
}
