# The input injector (XTEST). One JSON object per line on stdin, one JSON answer per line on stdout, after the X server has taken the event (a round trip), with the pointer where it is now.
#   {"id":1,"op":"move","x":10,"y":20}        {"id":2,"op":"button","n":1,"down":true}      {"id":3,"op":"key","name":"Return","down":true}
#   {"id":4,"op":"scroll","dx":0,"dy":120}     {"id":5,"op":"type","text":"hello"}            {"id":6,"op":"pointer"}
import json
import sys

from Xlib import X, XK, display
from Xlib.ext import xtest

d = display.Display()
root = d.screen().root
SHIFT = d.keysym_to_keycode(XK.string_to_keysym("Shift_L"))
NAMED = {"\n": "Return", "\t": "Tab", " ": "space"}


def pointer():
    p = root.query_pointer()
    return {"x": p.root_x, "y": p.root_y}


def keycodes(keysym):
    found = d.keysym_to_keycodes(keysym)
    for code, index in found:
        if code:
            return code, bool(index & 1)
    return None, False


def key_named(name, down):
    sym = XK.string_to_keysym(name)
    if sym == 0:
        raise ValueError("unknown key " + name)
    code, shifted = keycodes(sym)
    if code is None:
        raise ValueError("no key for " + name)
    if down and shifted:
        xtest.fake_input(d, X.KeyPress, SHIFT)
    xtest.fake_input(d, X.KeyPress if down else X.KeyRelease, code)
    if (not down) and shifted:
        xtest.fake_input(d, X.KeyRelease, SHIFT)


def type_text(text):
    for ch in text:
        name = NAMED.get(ch)
        sym = XK.string_to_keysym(name) if name else ord(ch)
        code, shifted = keycodes(sym)
        if code is None:
            raise ValueError("cannot type " + repr(ch))
        if shifted:
            xtest.fake_input(d, X.KeyPress, SHIFT)
        xtest.fake_input(d, X.KeyPress, code)
        xtest.fake_input(d, X.KeyRelease, code)
        if shifted:
            xtest.fake_input(d, X.KeyRelease, SHIFT)


def scroll(dx, dy):
    # One wheel click is about 40 pixels. Buttons 4 and 5 are up and down, 6 and 7 left and right.
    for amount, minus, plus in ((dy, 4, 5), (dx, 6, 7)):
        clicks = min(50, max(0, round(abs(amount) / 40)))
        if amount != 0 and clicks == 0:
            clicks = 1
        button = plus if amount > 0 else minus
        for _ in range(clicks):
            xtest.fake_input(d, X.ButtonPress, button)
            xtest.fake_input(d, X.ButtonRelease, button)


def handle(req):
    op = req.get("op")
    if op == "move":
        xtest.fake_input(d, X.MotionNotify, x=int(req["x"]), y=int(req["y"]))
    elif op == "button":
        xtest.fake_input(d, X.ButtonPress if req.get("down") else X.ButtonRelease, int(req["n"]))
    elif op == "key":
        key_named(str(req["name"]), bool(req.get("down")))
    elif op == "type":
        type_text(str(req["text"]))
    elif op == "scroll":
        scroll(int(req.get("dx", 0)), int(req.get("dy", 0)))
    elif op == "pointer":
        pass
    else:
        raise ValueError("unknown op " + str(op))
    d.sync()
    return pointer()


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except ValueError:
        continue
    try:
        out = {"id": req.get("id"), "ok": True, **handle(req)}
    except Exception as e:  # a bad key name or value is an answer, not a crash
        out = {"id": req.get("id"), "ok": False, "error": str(e)}
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()
