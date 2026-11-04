// Overview tab body (owner: l-editor). The shell renders ProjectOverview(props: ProjectTabProps); replace this stub with the editable page in the shared MarkdownEditor.
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { ProjectTabProps } from "../tabs.ts";

export function ProjectOverview({ projectId }: ProjectTabProps): ReactElement {
  return <View testID="project-overview-stub"><Text>{`Overview of ${projectId}`}</Text></View>;
}
