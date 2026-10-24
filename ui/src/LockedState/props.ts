// Frozen props for ui/LockedState. Spec 4.8 and 4.12, ARCH 4.13, F9.
// A deny of no_grant or role_lacks_permission shows this, with Ask for access.
// access.request opens one Review task per person and resource. Guests cannot
// request. The same state shows Waiting, Granted or Declined.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

export type LockedReason = "no_grant" | "role_lacks_permission";

/** Same four levels as access.share. The request asks for one of them. */
export type LockedLevel = "view" | "use" | "edit" | "manage";

export type AccessRequestStatus = "none" | "waiting" | "granted" | "declined";

export const ASK_FOR_ACCESS_LABEL = "Ask for access";

export const ACCESS_REQUEST_STATUS_LABEL: Record<AccessRequestStatus, string> = {
  none: "Ask for access",
  waiting: "Waiting",
  granted: "Granted",
  declined: "Declined",
};

export interface LockedStateProps {
  resourceType: string;
  resourceId: string;
  title: string;
  reason: LockedReason;
  level: LockedLevel;
  status: AccessRequestStatus;
  /** False for a guest, and while a request for this person and resource is open. */
  canRequest: boolean;
  note: string;
  density: Density;
}

export const frozenLockedStateProps = {
  resourceType: "folder",
  resourceId: "fld_clients",
  title: "Clients",
  reason: "no_grant",
  level: "view",
  status: "none",
  canRequest: true,
  note: "",
  density: "compact",
} as const satisfies LockedStateProps;
