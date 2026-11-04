// Console > Skills (owner ruling 3 Nov): the admin's view of the same parts as Settings > Skills (apps/app/src/skills). Space-wide skills apply to every member and their agents at once, with no
// card; install, update and remove them here. Members' own skills show by name only, and the ones they shared can be made Space-wide. The scripts rule (off by default) lives here too.
import type { ReactElement } from "react";
import { useConsoleData } from "../shell/data.tsx";
import { SkillsPage as SkillsView } from "../../skills/SkillsView.tsx";

export function SkillsPage(): ReactElement {
  const { call } = useConsoleData();
  return <SkillsView call={call} mode="console" />;
}
