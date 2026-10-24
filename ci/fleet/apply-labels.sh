#!/usr/bin/env bash
# Add the fleet labels from labels.json to every runner (additive, idempotent). Needs gh with repo admin.
set -eu
cd "$(dirname "$0")"
REPO="$(python3 -c 'import json;print(json.load(open("labels.json"))["repo"])')"
python3 - "$REPO" <<'PY' | while read -r id name labels; do
import json, subprocess, sys
repo = sys.argv[1]; cfg = json.load(open("labels.json"))
runners = json.loads(subprocess.check_output(["gh", "api", f"repos/{repo}/actions/runners", "--paginate", "--jq", "[.runners[]|{id,name}]"]))
for h in cfg["hosts"].values():
    for r in h["runners"]:
        m = [x for x in runners if x["name"] == r]
        if m: print(m[0]["id"], r, ",".join(cfg["common"] + [h["label"], r]))
PY
  args=(); for l in ${labels//,/ }; do args+=(-f "labels[]=$l"); done
  gh api -X POST "repos/$REPO/actions/runners/$id/labels" "${args[@]}" --jq '[.labels[].name]|join(",")' | sed "s/^/$name: /"
done
