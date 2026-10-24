// Mount for P-L9_19: the app's place route as it renders before a place packet registers its screen.
import PlaceholderPlace from "../../../apps/app/src/startup/PlaceholderPlace.tsx";

export const title = "App place route";

export default function Mount() {
  return <PlaceholderPlace place="home" />;
}
