// Console > Skills (owner ruling 3 Nov): the admin's view of the same parts as Settings > Skills (apps/app/src/skills). It opens with "Installed for the Space" (everything installed from a link, with Update and
// Remove), then the Space-wide skills, which apply to every member and their agents at once. Members' own skills show by name only, and the ones they shared can be made Space-wide. The scripts rule lives here too.
import type { ReactElement } from "react";
import { View } from "react-native";
import { useConsoleData } from "../shell/data.tsx";
import { SkillsPage as SkillsView } from "../../skills/SkillsView.tsx";
import { InstalledForSpace } from "./InstalledForSpace.tsx";

export function SkillsPage(): ReactElement {
  const { call, name } = useConsoleData();
  return <View><InstalledForSpace call={call} nameOf={name} /><SkillsView call={call} mode="console" /></View>;
}
