// A conversation drawn inside another page's frame (a project's Chat tab): the page's own header is the only title, so the conversation leaves its title out and keeps its controls (people,
// find, pane, More, helpers) in one slim row under the tabs.
import { createContext, useContext } from "react";

const InProject = createContext(false);
export const InProjectFrame = InProject.Provider;
export const useInProjectFrame = (): boolean => useContext(InProject);
