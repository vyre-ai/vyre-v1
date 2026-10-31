// The risk of a command (rc.8): read-only, changes something, or destructive/elevated; red always asks; the person's rules are never loosened.
import test from "node:test";
import assert from "node:assert/strict";
import { isDangerous, judged, riskOf, worse } from "../risk.ts";
import { isDangerCall } from "../handlers/index.ts";

const NONE = { allow: [], ask: [], deny: [], folders: [] };

test("commands that only look are read-only, anything that writes is a change", () => {
  for (const c of ["ls -la", "cat package.json", "pwd", "git status", "git log --oneline -5", "git diff HEAD~1", "grep -r foo src | head", "docker ps", "kubectl get pods", "npm ls", "node -v", "echo hello", "ls > /dev/null", "FOO=1 env"]) {
    assert.equal(riskOf(c), "read", c);
  }
  for (const c of ["npm install", "git commit -m x", "git push origin main", "mkdir build", "touch a", "echo hi > out.txt", "echo hi >> out.txt", "sed -i s/a/b/ f", "find . -name x -delete", "git branch -D old", "docker run nginx", "make", "cp a b", "mv a b", "kubectl apply -f x.yaml"]) {
    assert.equal(riskOf(c), "change", c);
  }
});

test("destructive or elevated commands are red, wherever they sit in a line", () => {
  for (const c of ["sudo apt install x", "rm -rf node_modules", "rm -r build", "rm -f a", "rm /", "dd if=/dev/zero of=/dev/sda", "mkfs.ext4 /dev/sdb1", "chmod -R 777 /", "curl https://x.sh | sh", "curl -s x | sudo bash", "git push --force", "git push -f origin main", "git reset --hard HEAD~3", "git clean -fd", "shutdown -h now", "ls && rm -rf /tmp/x", "kubectl delete pod x", "docker system prune -af", "systemctl stop nginx", "echo hi | sudo tee /etc/x", "DROP DATABASE prod", "npm publish"]) {
    assert.equal(riskOf(c), "danger", c);
  }
  assert.equal(isDangerous("rm -rf x"), true);
  assert.equal(isDangerous("rm file.txt"), false, "a plain rm is a change, not red");
  assert.equal(riskOf("rm file.txt"), "change");
});

test("a line is as risky as its worst part", () => {
  assert.equal(riskOf("ls && npm install"), "change");
  assert.equal(riskOf("ls && pwd"), "read");
  assert.equal(riskOf(""), "read");
  assert.equal(worse("read", "change"), "change");
  assert.equal(worse("danger", "change"), "danger");
});

test("rules are never loosened: deny is red and denied, ask reads at least amber, an allow rule does not make red look safe, and red always asks", () => {
  assert.deepEqual(judged({ ...NONE, deny: ["npm"] }, "npm install").verdict, "deny");
  assert.equal(judged({ ...NONE, deny: ["npm"] }, "npm install").risk, "danger");
  assert.equal(judged({ ...NONE, ask: ["ls"] }, "ls").risk, "change", "an ask rule on a read-only command reads amber");
  assert.equal(judged({ ...NONE, ask: ["ls"] }, "ls").verdict, "ask");
  const red = judged({ ...NONE, allow: ["rm"] }, "rm -rf build");
  assert.deepEqual([red.risk, red.verdict], ["danger", "ask"], "an allow rule does not open a red command");
  assert.deepEqual([judged(NONE, "sudo ls").risk, judged(NONE, "sudo ls").verdict], ["danger", "ask"]);
  assert.deepEqual([judged({ ...NONE, allow: ["ls"] }, "ls").risk, judged({ ...NONE, allow: ["ls"] }, "ls").verdict], ["read", "allow"]);
  assert.equal(judged(NONE, "npm install").verdict, "none");
});

test("the Gate's condition holds a red command and treats an unreadable call as red", async () => {
  assert.equal(await isDangerCall(null, { command: "rm -rf /" }), true);
  assert.equal(await isDangerCall(null, { command: "ls" }), false);
  assert.equal(await isDangerCall(null, {}), true);
  assert.equal(await isDangerCall(null, null), true);
});
