// Linked tab body (owner: l-artifacts). The shell renders ProjectLinked(props: ProjectTabProps); replace this stub with the Linked page (Show menu, Link something, Link automatically, auto marks).
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { ProjectTabProps } from "../tabs.ts";

export function ProjectLinked({ projectId }: ProjectTabProps): ReactElement {
  return <View testID="project-linked-stub"><Text>{`Linked to ${projectId}`}</Text></View>;
}
