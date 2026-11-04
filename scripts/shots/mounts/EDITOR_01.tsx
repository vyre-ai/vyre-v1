// Mount for l-editor: the chat composer with a long draft and three @mentions over ten lines, so the wash behind the field can be checked against the words it names, at rest and scrolled.
import { View, useWindowDimensions } from "react-native";
import { Composer } from "../../../ui/src/Composer/index.tsx";

export const title = "Composer mentions";

const DRAFT = [
  "Kickoff notes for the Meier file, written the morning after the call so nothing is lost.",
  "@Aliza please confirm that the engagement letter went out and that the client was able to sign it on the first try.",
  "The retainer is paid, the intake form is complete, and the conflict check came back clean.",
  "Two open questions remain about the trust schedule and who holds the originals.",
  "@Rubab can you check the numbers on CX before the Thursday review, and tell us what is still missing.",
  "I will draft the cover note tonight and send it for a read before it goes anywhere.",
  "Nothing here goes to the client until someone has seen the final version in full.",
  "The calendar hold for Friday stays until the court confirms the new date for the hearing.",
  "@Sol keep an eye on the filing portal over the weekend and post anything that changes.",
  "Thanks all, this is the last note for today.",
].join("\n");

export default function Mount() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: phone ? 12 : 28, paddingBottom: phone ? 12 : 18 }}>
      <View style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}>
        <Composer whoWillAnswer="Aliza, Rubab and Sol will reply" lead="Aliza" label="Message" density={phone ? "compact" : "regular"} value={DRAFT} lists={{ agents: ["Aliza", "Rubab", "Sol"], people: [] }} />
      </View>
    </View>
  );
}
