// The colon picker's data: a short name for each of the emoji people reach for, with a few other words that find it. Typing ":smi" offers every entry whose name or word starts with "smi".

export interface EmojiEntry {
  char: string;
  name: string;
  words?: string;
}

const E = (char: string, name: string, words?: string): EmojiEntry => (words === undefined ? { char, name } : { char, name, words });

export const EMOJI: readonly EmojiEntry[] = [
  E("😀", "grinning", "happy smile"), E("😃", "smiley", "happy smile"), E("😄", "smile", "happy grin"), E("😁", "grin", "beam"), E("😆", "laughing", "lol"),
  E("😅", "sweat_smile", "relief"), E("🤣", "rofl", "lol laugh"), E("😂", "joy", "lol tears laugh"), E("🙂", "slight_smile", "smile"), E("🙃", "upside_down", "silly"),
  E("😉", "wink", "flirt"), E("😊", "blush", "smile happy"), E("😇", "innocent", "angel halo"), E("🥰", "smiling_hearts", "love adore"), E("😍", "heart_eyes", "love"),
  E("🤩", "star_struck", "wow"), E("😘", "kiss", "blow_kiss"), E("😋", "yum", "tasty"), E("😛", "tongue", "silly"), E("😜", "wink_tongue", "silly"),
  E("🤪", "zany", "crazy"), E("🤗", "hug", "hugging"), E("🤭", "giggle", "oops"), E("🤔", "thinking", "hmm think"), E("🤨", "raised_eyebrow", "skeptical"),
  E("😐", "neutral", "meh"), E("😑", "expressionless", "blank"), E("😶", "no_mouth", "silent"), E("🙄", "eye_roll", "rolling_eyes"), E("😏", "smirk", "sly"),
  E("😣", "persevere", "struggle"), E("😥", "sad_relieved", "phew"), E("😮", "open_mouth", "surprised wow"), E("😯", "hushed", "surprised"), E("😪", "sleepy", "tired"),
  E("😴", "sleeping", "zzz tired"), E("😌", "relieved", "calm"), E("😎", "cool", "sunglasses"), E("🤓", "nerd", "glasses"), E("🥳", "party", "celebrate birthday"),
  E("😕", "confused", "puzzled"), E("😟", "worried", "anxious"), E("🙁", "frown", "sad"), E("😢", "cry", "sad tear"), E("😭", "sob", "crying sad"),
  E("😱", "scream", "shocked fear"), E("😖", "confounded", "upset"), E("😞", "disappointed", "sad"), E("😓", "downcast_sweat", "tired"), E("😩", "weary", "tired"),
  E("😤", "triumph", "huffing"), E("😡", "angry", "mad rage"), E("😠", "mad", "angry"), E("🤬", "swearing", "cursing angry"), E("😈", "smiling_devil", "imp"),
  E("💀", "skull", "dead"), E("💩", "poop", "shit"), E("🤡", "clown", "joker"), E("👻", "ghost", "boo"), E("👽", "alien", "ufo"),
  E("🤖", "robot", "bot ai"), E("🙈", "see_no_evil", "monkey"), E("🙉", "hear_no_evil", "monkey"), E("🙊", "speak_no_evil", "monkey"),
  E("👍", "thumbsup", "+1 yes ok approve like"), E("👎", "thumbsdown", "-1 no dislike"), E("👌", "ok_hand", "perfect"), E("✌️", "victory", "peace"), E("🤞", "fingers_crossed", "luck hope"),
  E("🤟", "love_you", "hand"), E("🤘", "rock_on", "horns"), E("🤙", "call_me", "shaka"), E("👈", "point_left", "left"), E("👉", "point_right", "right"),
  E("👆", "point_up", "up"), E("👇", "point_down", "down"), E("☝️", "index_up", "one"), E("✋", "raised_hand", "stop high_five"), E("🖐️", "hand", "palm"),
  E("👋", "wave", "hello hi bye"), E("🤝", "handshake", "deal agree"), E("🙏", "pray", "thanks please folded_hands"), E("👏", "clap", "applause bravo"), E("🙌", "raised_hands", "hooray praise"),
  E("💪", "muscle", "strong flex"), E("✍️", "writing", "write"), E("🧠", "brain", "think smart"), E("👀", "eyes", "look watching"), E("👁️", "eye", "look"),
  E("❤️", "heart", "love red"), E("🧡", "orange_heart", "love"), E("💛", "yellow_heart", "love"), E("💚", "green_heart", "love"), E("💙", "blue_heart", "love"),
  E("💜", "purple_heart", "love"), E("🖤", "black_heart", "love"), E("💔", "broken_heart", "sad"), E("💕", "two_hearts", "love"), E("💯", "hundred", "100 perfect score"),
  E("🔥", "fire", "hot lit"), E("✨", "sparkles", "shine magic"), E("⭐", "star", "favorite"), E("🌟", "glowing_star", "shine"), E("💥", "boom", "collision"),
  E("🎉", "tada", "party celebrate congrats"), E("🎊", "confetti", "party"), E("🎂", "birthday", "cake"), E("🎁", "gift", "present"), E("🏆", "trophy", "win"),
  E("🥇", "first_place", "gold medal win"), E("🎯", "target", "bullseye goal"), E("🚀", "rocket", "launch ship"), E("💡", "bulb", "idea light"), E("📌", "pin", "pushpin"),
  E("✅", "check", "done yes white_check_mark"), E("☑️", "ballot_check", "done"), E("✔️", "tick", "check done"), E("❌", "cross", "no x wrong"), E("❎", "cross_box", "no"),
  E("⚠️", "warning", "caution alert"), E("🚨", "siren", "alert emergency"), E("⛔", "no_entry", "stop"), E("🚫", "prohibited", "no"), E("❓", "question", "what"),
  E("❗", "exclamation", "important"), E("‼️", "double_exclamation", "important"), E("💬", "speech", "comment chat"), E("💭", "thought", "think"), E("📝", "memo", "note write"),
  E("📅", "calendar", "date"), E("📆", "tear_calendar", "date"), E("⏰", "alarm", "clock time"), E("⏳", "hourglass", "wait time"), E("⌛", "sand_clock", "wait"),
  E("📎", "paperclip", "attach"), E("🔗", "link", "chain url"), E("🔒", "lock", "secure private"), E("🔓", "unlock", "open"), E("🔑", "key", "password"),
  E("📧", "email", "mail"), E("📨", "incoming_mail", "email"), E("📞", "phone", "call"), E("📱", "mobile", "phone"), E("💻", "laptop", "computer"),
  E("🖥️", "desktop", "computer"), E("⌨️", "keyboard", "type"), E("🔧", "wrench", "fix tool"), E("🔨", "hammer", "build tool"), E("⚙️", "gear", "settings"),
  E("🐛", "bug", "insect error"), E("🧪", "test_tube", "test experiment"), E("📊", "bar_chart", "chart stats"), E("📈", "chart_up", "growth trend"), E("📉", "chart_down", "decline trend"),
  E("💰", "money_bag", "cash dollar"), E("💵", "dollar", "money cash"), E("💳", "credit_card", "pay"), E("🏠", "house", "home"), E("🏢", "office", "building"),
  E("☕", "coffee", "tea drink"), E("🍕", "pizza", "food"), E("🍔", "burger", "food"), E("🍺", "beer", "drink"), E("🍷", "wine", "drink"),
  E("🍎", "apple", "fruit"), E("🍌", "banana", "fruit"), E("🍰", "cake_slice", "dessert"), E("🍪", "cookie", "dessert"), E("🌮", "taco", "food"),
  E("☀️", "sun", "sunny weather"), E("🌙", "moon", "night"), E("⛅", "partly_sunny", "weather"), E("🌧️", "rain", "weather"), E("❄️", "snowflake", "cold winter"),
  E("🌈", "rainbow", "pride"), E("🌱", "seedling", "grow plant"), E("🌳", "tree", "plant"), E("🌸", "blossom", "flower"), E("🌹", "rose", "flower"),
  E("🐶", "dog", "puppy pet"), E("🐱", "cat", "kitten pet"), E("🦁", "lion", "simba"), E("🐯", "tiger", "cat"), E("🐻", "bear", "animal"),
  E("🦊", "fox", "animal"), E("🐼", "panda", "animal"), E("🐸", "frog", "animal"), E("🐵", "monkey", "animal"), E("🦄", "unicorn", "magic"),
  E("🐝", "bee", "busy"), E("🦋", "butterfly", "insect"), E("🐢", "turtle", "slow"), E("🐙", "octopus", "sea"), E("🐳", "whale", "sea"),
  E("⚽", "soccer", "football sport"), E("🏀", "basketball", "sport"), E("🎮", "game", "controller video"), E("🎵", "music", "note song"), E("🎧", "headphones", "music"),
  E("📷", "camera", "photo"), E("🎬", "clapper", "movie film"), E("📚", "books", "read"), E("📖", "book", "read"), E("🎓", "graduation", "learn school"),
  E("✈️", "plane", "flight travel"), E("🚗", "car", "drive"), E("🚲", "bike", "cycle"), E("🌍", "earth", "world globe"), E("🗺️", "map", "world"),
  E("➡️", "arrow_right", "next"), E("⬅️", "arrow_left", "back"), E("⬆️", "arrow_up", "up"), E("⬇️", "arrow_down", "down"), E("🔄", "refresh", "repeat sync"),
  E("➕", "plus", "add"), E("➖", "minus", "remove"), E("🆗", "ok", "okay"), E("🆕", "new", "fresh"), E("🔴", "red_circle", "red"),
  E("🟢", "green_circle", "green"), E("🟡", "yellow_circle", "yellow"), E("🔵", "blue_circle", "blue"), E("⚡", "zap", "lightning fast"), E("🎈", "balloon", "party"),
];

/** The entries a typed name finds: names that start with it first, then names that contain it, then other words; at most `limit`. */
export function findEmoji(query: string, limit = 8): EmojiEntry[] {
  const q = query.toLowerCase().replace(/^:/, "");
  if (q.length === 0) return [];
  const starts: EmojiEntry[] = [], inside: EmojiEntry[] = [], words: EmojiEntry[] = [];
  for (const e of EMOJI) {
    if (e.name.startsWith(q)) starts.push(e);
    else if (e.name.includes(q)) inside.push(e);
    else if ((e.words ?? "").split(" ").some((w) => w.startsWith(q))) words.push(e);
  }
  const short = (a: EmojiEntry, b: EmojiEntry): number => a.name.length - b.name.length;
  return [...starts.sort(short), ...inside, ...words].slice(0, limit);
}

/** A whole ":name:" typed up to the cursor becomes its emoji; anything that is not an exact name stays as typed. */
export function closeEmoji(text: string, cursor: number): { text: string; cursor: number } | null {
  const before = text.slice(0, cursor);
  const m = /(^|\s):([a-zA-Z0-9_+-]{2,}):$/.exec(before);
  if (!m) return null;
  const name = (m[2] ?? "").toLowerCase();
  const hit = EMOJI.find((e) => e.name === name);
  if (!hit) return null;
  const head = before.slice(0, before.length - name.length - 2) + hit.char;
  return { text: head + text.slice(cursor), cursor: head.length };
}
