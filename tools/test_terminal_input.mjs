/**
 * Tests for the terminal input router.
 *
 *     node --experimental-strip-types tools/test_terminal_input.mjs
 *
 * Simulates typing and asserts what the shell would receive and what would be
 * executed as a dnet command. The bug this guards against is subtle and its
 * symptom is misleading: a leak shows up as the shell reporting
 * "'dnet' is not recognized", which reads like a PATH problem.
 */

import assert from "node:assert/strict";
import {
  BACKSPACE,
  CR,
  CTRL_C,
  ESC,
  consumeChunk,
  initialState,
} from "../src/lib/terminalInput.ts";

const PREFIX = "dnet";

/** Type a sequence of chunks; report what the shell saw and what ran. */
function type(...chunks) {
  let state = initialState();
  let sent = "";
  const executed = [];

  for (const chunk of chunks) {
    const step = consumeChunk(state, chunk, PREFIX);
    state = step.state;
    for (const fx of step.effects) {
      sent += fx.send;
      if (fx.execute !== undefined) executed.push(fx.execute);
    }
  }
  return { sent, executed, state };
}

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split("\n")[0]}`);
  }
}

console.log("terminal input router\n");

check("a dnet command never reaches the shell", () => {
  const { sent, executed } = type("dnet help", CR);
  assert.equal(sent, "", "the shell must receive nothing");
  assert.deepEqual(executed, ["dnet help"]);
});

check("typed fast, as one batched chunk", () => {
  // xterm delivers this as a single onData when typing quickly. This exact
  // case leaked the whole line to the shell.
  const { sent, executed } = type("dnet help" + CR);
  assert.equal(sent, "");
  assert.deepEqual(executed, ["dnet help"]);
});

check("split across arbitrary chunk boundaries", () => {
  const { sent, executed } = type("d", "ne", "t he", "lp", CR);
  assert.equal(sent, "");
  assert.deepEqual(executed, ["dnet help"]);
});

check("uppercase is still ours", () => {
  const { sent, executed } = type("DNET help", CR);
  assert.equal(sent, "");
  assert.deepEqual(executed, ["DNET help"]);
});

check("bare dnet runs help", () => {
  const { sent, executed } = type("dnet", CR);
  assert.equal(sent, "");
  assert.deepEqual(executed, ["dnet"]);
});

check("an ordinary command reaches the shell intact", () => {
  const { sent, executed } = type("dir", CR);
  assert.equal(sent, "dir" + CR);
  assert.deepEqual(executed, []);
});

check("a command starting with d but not dnet is intact", () => {
  const { sent, executed } = type("del foo.txt", CR);
  assert.equal(sent, "del foo.txt" + CR);
  assert.deepEqual(executed, []);
});

check("a command sharing more of the prefix is intact", () => {
  const { sent, executed } = type("dnetwork --status", CR);
  assert.equal(sent, "dnetwork --status" + CR);
  assert.deepEqual(executed, []);
});

check("nothing is held after the first word", () => {
  // Only the start of a line is ambiguous; "dnet" as an argument is the
  // shell's business.
  const { sent, executed } = type("echo dnet help", CR);
  assert.equal(sent, "echo dnet help" + CR);
  assert.deepEqual(executed, []);
});

check("backspacing out of a held prefix", () => {
  const { sent, executed } = type("dn", BACKSPACE, BACKSPACE, "ls", CR);
  assert.equal(sent, "ls" + CR);
  assert.deepEqual(executed, []);
});

check("backspacing inside a dnet line then completing it", () => {
  const { sent, executed } = type("dnet helq", BACKSPACE, "p", CR);
  assert.equal(sent, "");
  assert.deepEqual(executed, ["dnet help"]);
});

check("ctrl-c abandons a dnet line without leaking it", () => {
  const { sent, executed } = type("dnet help", CTRL_C);
  assert.equal(sent, CR, "only a prompt redraw");
  assert.deepEqual(executed, []);
});

check("arrow keys pass through and settle the line", () => {
  const { sent } = type(`${ESC}[A`);
  assert.equal(sent, `${ESC}[A`);
});

check("a second command on the next line is decided afresh", () => {
  const { sent, executed } = type("dir", CR, "dnet frames", CR);
  assert.equal(sent, "dir" + CR);
  assert.deepEqual(executed, ["dnet frames"]);
});

check("a dnet command after a shell command in one chunk", () => {
  const { sent, executed } = type("dir" + CR + "dnet frames" + CR);
  assert.equal(sent, "dir" + CR);
  assert.deepEqual(executed, ["dnet frames"]);
});

check("held characters are released in order", () => {
  const { sent } = type("dnx", CR);
  assert.equal(sent, "dnx" + CR, "the held dn must precede the x");
});

check("erase count matches what was echoed", () => {
  let state = initialState();
  let echoed = 0;
  let erased = 0;
  for (const chunk of ["dn", "x"]) {
    const step = consumeChunk(state, chunk, PREFIX);
    state = step.state;
    for (const fx of step.effects) {
      echoed += fx.echo.length;
      erased += fx.erase;
    }
  }
  assert.equal(erased, echoed, "every locally echoed character must be erased");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
