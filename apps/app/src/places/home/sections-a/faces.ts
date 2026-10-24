// Faces a person can assign to. Ids match the frozen core seed (fixtures/seed/core/recipe.ts):
// PEOPLE, AGENTS, GROUPS, and the five roles. Apps cannot import that fixture (it sits outside the layer tree).

export type FaceKind = "person" | "agent" | "group" | "role" | "automation";

export interface Face {
  kind: FaceKind;
  id: string;
  name: string;
}

export const FACE_ICON: Record<FaceKind, string> = {
  person: "user",
  agent: "bot",
  group: "users",
  role: "badge",
  automation: "play",
};

export const CORE_SEED_FACES: readonly Face[] = [
  { kind: "person", id: "usr_olivia", name: "Olivia Park" },
  { kind: "person", id: "usr_adam", name: "Adam Reyes" },
  { kind: "person", id: "usr_mia", name: "Mia Chen" },
  { kind: "person", id: "usr_noah", name: "Noah Berg" },
  { kind: "person", id: "usr_sana", name: "Sana Iqbal" },
  { kind: "person", id: "usr_tess", name: "Tess Okoye" },
  { kind: "agent", id: "agt_scout", name: "Scout" },
  { kind: "agent", id: "agt_helper", name: "Helper" },
  { kind: "group", id: "grp_everyone", name: "Everyone" },
  { kind: "group", id: "grp_staff", name: "Staff" },
  { kind: "group", id: "grp_leads", name: "Lead team" },
  { kind: "role", id: "owner", name: "Owner" },
  { kind: "role", id: "admin", name: "Admin" },
  { kind: "role", id: "manager", name: "Manager" },
  { kind: "role", id: "member", name: "Member" },
  { kind: "role", id: "temp", name: "Temp" },
];

const KINDS: readonly FaceKind[] = ["person", "agent", "group", "role", "automation"];

export function isFaceKind(value: string): value is FaceKind {
  return (KINDS as readonly string[]).includes(value);
}

export function faceFor(faces: readonly Face[], assigned: { kind: string; id: string }): Face {
  const found = faces.find((face) => face.id === assigned.id);
  if (found) return found;
  const kind = isFaceKind(assigned.kind) ? assigned.kind : "person";
  return { kind, id: assigned.id, name: assigned.id };
}

export function faceName(faces: readonly Face[], id: string): string {
  return faces.find((face) => face.id === id)?.name ?? id;
}
