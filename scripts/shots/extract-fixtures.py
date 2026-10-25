#!/usr/bin/env python3
"""Reads the seed data straight out of the prototype copy (scripts/shots/prototype/vyre-v1.html) and writes
apps/app/src/fixtures/prototype-data.ts. The fixtures test re-reads the same source and compares, so a prototype change that
the fixtures do not follow fails CI. Run: python3 scripts/shots/extract-fixtures.py"""
import html, json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts/shots/prototype/vyre-v1.html"
OUT = ROOT / "apps/app/src/fixtures/prototype-data.ts"
TEXT = html.unescape(SRC.read_text(encoding="utf8"))


def _F(id, n, t, w, x=None):
    d = {"id": id, "n": n, "t": t, "w": w}
    d.update(x or {})
    return d


def _O(*a):
    out = []
    for v in a:
        parts = v.split("|")
        out.append([parts[0], None if len(parts) < 2 or parts[1] == "" else int(parts[1])])
    return out


# the prototype's schema helpers, evaluated while parsing: F(id, name, type, width, extra) and O("Lead|220", ...)
CALLS = {"F": _F, "O": _O}


def js_to_json(js: str):
    """A JS literal made of strings, numbers, true/false/null, arrays and objects with bare keys -> Python."""
    out, i, n = [], 0, len(js)
    while i < n:
        c = js[i]
        if c in "\"'":
            q, j = c, i + 1
            while js[j] != q:
                j += 2 if js[j] == "\\" else 1
            body = js[i + 1:j]
            out.append(json.dumps(body.replace("\\'", "'") if q == "'" else json.loads('"' + body + '"')))
            i = j + 1
        elif c.isalpha() or c == "_":
            j = i
            while j < n and (js[j].isalnum() or js[j] == "_"):
                j += 1
            word = js[i:j]
            if j < n and js[j] == "(" and word in CALLS:
                call = balanced(js, j)
                out.append(json.dumps(CALLS[word](*js_to_json("[" + call[1:-1] + "]"))))
                i = j + len(call)
                continue
            k = j
            while k < n and js[k] == " ":
                k += 1
            out.append(json.dumps(word) if k < n and js[k] == ":" else word)
            i = j
        elif c == "." and i + 1 < n and js[i + 1].isdigit() and not (out and out[-1][-1:].isdigit()):
            out.append("0.")
            i += 1
        else:
            out.append(c)
            i += 1
    return json.loads(re.sub(r",(\s*[\]}])", r"\1", "".join(out)))


def balanced(s: str, start: int) -> str:
    """The bracketed literal that opens at s[start] ('[' or '{'), strings respected."""
    depth, i = 0, start
    while True:
        c = s[i]
        if c in "\"'":
            q = c
            i += 1
            while s[i] != q:
                i += 2 if s[i] == "\\" else 1
        elif c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
        i += 1


def const(name: str, after: int = 0):
    m = re.compile(r"const " + re.escape(name) + r" = ").search(TEXT, after)
    if not m:
        sys.exit("not found: " + name)
    return js_to_json(balanced(TEXT, m.end())), m.end()


seed_at = TEXT.index("function seedData()")
data = {}
for k in ["FIRST", "LAST", "STREETS", "CITIES", "NEXTS", "KINDS", "TASKT"]:
    data[k], _ = const(k, TEXT.index("function mulberry32"))
hand_m = re.compile(r"const hand = ").search(TEXT, seed_at)
data["HAND"] = js_to_json(balanced(TEXT, hand_m.end()))
team_m = re.compile(r'const TEAM = ').search(TEXT, TEXT.index("/* ---------- schema ---------- */"))
data["TEAM"] = js_to_json(balanced(TEXT, team_m.end()))
data["AGS"] = js_to_json(balanced(TEXT, TEXT.index("AGS = ", TEXT.index("/* ---------- schema ---------- */")) + 6))


def calls(name: str, start_marker: str) -> list:
    """The argument lists of every `name(...)` call in the array literal that follows start_marker, each as a list of values."""
    a = TEXT.index(start_marker, seed_at)
    lit = balanced(TEXT, TEXT.index("[", a))
    out, i = [], 0
    while True:
        m = re.compile(r"\b" + name + r"\(").search(lit, i)
        if not m:
            return out
        call = balanced(lit, m.end() - 1)
        out.append(js_to_json("[" + call[1:-1] + "]"))
        i = m.end() + len(call)


data["HP"] = calls("P", "const hp = ")
data["HI"] = calls("mkI", "const hi = ")
data["HM"] = calls("mkM", "const hm = ")
data["HT"] = calls("mkT", "const ht = ")
ty_a = TEXT.index("const TY = {};", TEXT.index("/* ---------- schema ---------- */"))
ty_b = TEXT.index("const TYPE_ORDER", ty_a)
types = {}
for m in re.finditer(r"^  TY\.(\w+) = ", TEXT[ty_a:ty_b], re.M):
    types[m.group(1)] = js_to_json(balanced(TEXT, ty_a + m.end()))
data["TYPES"] = types
data["CHN"], _ = const("CHN", seed_at)
data["CHW"], _ = const("CHW", seed_at)

# the Harbor Studio and Personal record types and rows (seedSpaces)
sp = TEXT.index("(function seedSpaces()")
sp_end = TEXT.index("/* the signed-in person's grants in this Space", sp)
block = TEXT[sp:sp_end]
rows = {}
for tid in ["pcontacts", "pnotes", "hclients", "hjobs"]:
    m = re.search(r'mk\("' + tid + r'", \{(.*?)\},\s*\n\s*(\[\{.*?\}\]), "', block + "\n", re.S)
    # the row list is the array literal that follows the type object; find it by balancing from the first '[{' after the type object closes
    start = block.index('mk("' + tid + '"')
    obj_open = block.index("{", start)
    obj = balanced(block, obj_open)
    arr_open = block.index("[{", obj_open + len(obj))
    arr = balanced(block, arr_open)
    fields = re.findall(r'F\("(\w+)", "([^"]+)", "(\w+)", (\d+)(?:, (\{.*?\}))?\)', obj)
    meta = {"title": re.search(r' n: "([^"]+)"', obj).group(1), "one": re.search(r'one: "([^"]+)"', obj).group(1), "primary": re.search(r'primary: "(\w+)"', obj).group(1)}
    flds = []
    for fid, fname, ftype, w, extra in fields:
        f = {"id": fid, "name": fname, "type": ftype, "width": int(w)}
        om = re.search(r'o: O\((.*?)\)', extra or "")
        if om:
            f["options"] = [[v.split("|")[0], (int(v.split("|")[1]) if "|" in v and v.split("|")[1] else None)] for v in re.findall(r'"([^"]*)"', om.group(1))]
        if extra and 'kind: "' in extra:
            f["kind"] = re.search(r'kind: "(\w+)"', extra).group(1)
        to = re.search(r'to: "(\w+)"', extra or "")
        if to:
            f["to"] = to.group(1)
        flds.append(f)
    rows[tid] = {"meta": meta, "fields": flds, "rows": js_to_json(arr)}
data["SPACES"] = rows

body = "// Generated by scripts/shots/extract-fixtures.py from scripts/shots/prototype/vyre-v1.html. Do not edit by hand.\n"
body += "// The fixtures test reads the prototype again and compares, so these cannot drift from it.\n\n"
for k in ["FIRST", "LAST", "STREETS", "CITIES", "NEXTS", "KINDS", "TASKT", "AGS", "TEAM", "CHN", "CHW", "HAND", "HP", "HI", "HM", "HT", "TYPES"]:
    body += "export const PROTO_%s: %s = %s;\n\n" % (k, "Readonly<Record<string, unknown>>" if k == "TYPES" else "readonly unknown[]", json.dumps(data[k], ensure_ascii=False, indent=1))
body += "export const PROTO_SPACE_TYPES: Readonly<Record<string, { meta: { title: string; one: string; primary: string }; fields: readonly { id: string; name: string; type: string; width: number; options?: readonly (readonly [string, number | null])[]; kind?: string; to?: string }[]; rows: readonly Record<string, unknown>[] }>> = %s;\n" % json.dumps(data["SPACES"], ensure_ascii=False, indent=1)
OUT.write_text(body, encoding="utf8")
print("wrote", OUT, len(body))

# ---- the chat module's seed (Northwind, Harbor Studio, Personal): spaces, agents, people, channels with their followed and starred flags, Needs you, chats, messages, files ...
def chat_seed():
    i = TEXT.index('  const seed = () => ({\n    space: "nw"')
    j = TEXT.index("({", i)
    lit = balanced(TEXT, j)
    base = js_to_json(lit[1:-1]) if lit.startswith("(") else js_to_json(lit)
    f = TEXT.index("  function seedFor(sp) {", i)
    end = TEXT.index("\n  }\n", f)
    body = TEXT[f:end]
    import copy

    def branch(name):
        a = body.index('if (sp === "%s") {' % name)
        # the branch ends where the next top-level `if (sp ===` starts or at the return
        nxt = [body.find('\n    if (sp === "', a + 10), body.find("\n    return b;", a)]
        b2 = min(x for x in nxt if x > 0)
        return body[a:b2]

    def assigns(block):
        out = {}
        for m in re.finditer(r"\bb\.(\w+) = ", block):
            k = m.group(1)
            start = m.end()
            if block[start] not in "[{":
                continue
            out[k] = js_to_json(balanced(block, start))
        return out

    spaces = {"nw": copy.deepcopy(base)}
    for key, name in (("hb", "harbor"), ("me", "personal")):
        b = copy.deepcopy(base)
        blk = branch(name)
        a = assigns(blk)
        # blank(): nothing from the team Space carries over except what the branch sets
        b.update({"sessions": [], "outside": [], "helpers": {}, "files": {}, "proposed": {}, "merged": {}, "agentEdits": {}})
        for k, v in a.items():
            if k in ("facts", "routines"):
                continue
            b[k] = v
        b["facts"] = {x["n"]: [] for x in b["agents"]}
        b["routines"] = {x["n"]: [] for x in b["agents"]}
        if name == "personal":
            r1 = copy.deepcopy(base["routines"]["Assistant"][0])
            r1["instr"] = re.search(r'r1\.instr = "([^"]*)"', blk).group(1)
            r1["made"] = ["you", "Oct 12", "m1"]
            r1["runs"] = [dict(x, res="5 lines · 2 due today") for x in r1["runs"]]
            b["routines"]["Assistant"] = [r1]
            m = re.search(r"b\.facts\.Assistant = (\[)", blk)
            b["facts"]["Assistant"] = js_to_json(balanced(blk, m.start(1)))
        for sp in b["spaces"]:
            sp["unread"] = 0
        b["space"] = key
        spaces[key] = b
    spaces["nw"]["space"] = "nw"
    return spaces


chat = chat_seed()
CHAT_OUT = ROOT / "apps/app/src/fixtures/prototype-chat.ts"
CHAT_OUT.write_text(
    "// Generated by scripts/shots/extract-fixtures.py from scripts/shots/prototype/vyre-v1.html. Do not edit by hand.\n"
    "// The chat module's seed for the three Spaces (nw, hb, me): agents, people, channels with followed and starred, Needs you, chats, messages. prototype-source.test.ts runs the prototype's own seed and compares.\n\n"
    "export const PROTO_CHAT: Readonly<Record<string, Readonly<Record<string, unknown>>>> = %s;\n" % json.dumps(chat, ensure_ascii=False, indent=1),
    encoding="utf8",
)
print("wrote", CHAT_OUT, CHAT_OUT.stat().st_size)
