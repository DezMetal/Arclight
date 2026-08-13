/**
 * Terminal input routing.
 *
 * Decides, character by character, whether keystrokes belong to the shell or
 * to a `dnet` command. Kept pure and free of xterm and React so it can be
 * tested directly — this logic has been wrong twice, and reasoning about it in
 * situ was not enough.
 *
 * The shell must never see a `dnet` line, or cmd answers with "'dnet' is not
 * recognized". Nothing can be decided from the first character alone, so input
 * at the start of a line is *held* while it could still become `dnet`, and
 * released the moment it cannot. At most a few characters are ever held, and
 * only at the start of a line.
 */

export const ESC = String.fromCharCode(27);
export const CR = "\r";
export const LF = "\n";
export const BACKSPACE = String.fromCharCode(127);
export const CTRL_C = String.fromCharCode(3);

export type Phase = "holding" | "passthrough" | "command";

export interface InputState {
  phase: Phase;
  /** Characters echoed locally but not yet given to the shell. */
  held: string;
  /** The command line being composed, once `dnet ` is confirmed. */
  line: string;
}

/** What the caller should do as a result of one character. */
export interface InputEffects {
  /** Bytes to hand to the shell. */
  send: string;
  /** Characters to echo locally. */
  echo: string;
  /** Number of characters to erase from the local echo. */
  erase: number;
  /** A completed `dnet` line to execute. */
  execute?: string;
}

export function initialState(): InputState {
  return { phase: "holding", held: "", line: "" };
}

const NONE: InputEffects = { send: "", echo: "", erase: 0 };

function effects(partial: Partial<InputEffects>): InputEffects {
  return { ...NONE, ...partial };
}

/**
 * Could `candidate` still grow into the command prefix?
 *
 * Case-insensitive, because `matchCustomCommand` lowercases the verb — holding
 * only lowercase meant `DNET help` was passed straight to the shell.
 */
function couldBecomePrefix(candidate: string, prefix: string): boolean {
  return prefix.toLowerCase().startsWith(candidate.toLowerCase());
}

function isPrefixWithArgs(candidate: string, prefix: string): boolean {
  return candidate.toLowerCase().startsWith(`${prefix.toLowerCase()} `);
}

/**
 * Feed one character through the machine.
 *
 * Returns the next state and what the caller should do. The state is replaced,
 * never mutated, so a caller can reason about a whole sequence.
 */
export function consume(
  state: InputState,
  ch: string,
  prefix: string,
): { state: InputState; effects: InputEffects } {
  const { phase, held, line } = state;

  // --- composing a dnet command -------------------------------------------
  if (phase === "command") {
    if (ch === CR || ch === LF) {
      return {
        state: initialState(),
        effects: effects({ execute: line }),
      };
    }
    if (ch === BACKSPACE) {
      if (line.length === 0) return { state, effects: NONE };
      const next = line.slice(0, -1);
      // Backspacing away the whole line returns to deciding afresh.
      return {
        state:
          next.length === 0
            ? initialState()
            : { phase: "command", held: "", line: next },
        effects: effects({ erase: 1 }),
      };
    }
    if (ch === CTRL_C) {
      // Abandon it and let the shell redraw its prompt.
      return { state: initialState(), effects: effects({ send: CR, echo: `^C${CR}${LF}` }) };
    }
    if (ch >= " ") {
      return {
        state: { phase: "command", held: "", line: line + ch },
        effects: effects({ echo: ch }),
      };
    }
    return { state, effects: NONE };
  }

  // --- the shell owns this line -------------------------------------------
  if (phase === "passthrough") {
    const next: InputState =
      ch === CR || ch === LF ? initialState() : state;
    return { state: next, effects: effects({ send: ch }) };
  }

  // --- still deciding ------------------------------------------------------
  if (ch === CR || ch === LF) {
    // Bare `dnet` with no arguments is still ours.
    if (held.toLowerCase() === prefix.toLowerCase()) {
      return { state: initialState(), effects: effects({ execute: held }) };
    }
    return {
      state: initialState(),
      effects: effects({ send: held + ch, erase: held.length }),
    };
  }

  if (ch === BACKSPACE) {
    if (held.length > 0) {
      return {
        state: { phase: "holding", held: held.slice(0, -1), line: "" },
        effects: effects({ erase: 1 }),
      };
    }
    return { state, effects: effects({ send: ch }) };
  }

  if (ch === CTRL_C) {
    return {
      state: { phase: "passthrough", held: "", line: "" },
      effects: effects({ send: ch, erase: held.length }),
    };
  }

  if (ch < " ") {
    // Any other control character settles it for the shell.
    return {
      state: { phase: "passthrough", held: "", line: "" },
      effects: effects({ send: held + ch, erase: held.length }),
    };
  }

  const candidate = held + ch;

  if (isPrefixWithArgs(candidate, prefix)) {
    return {
      state: { phase: "command", held: "", line: candidate },
      effects: effects({ echo: ch }),
    };
  }

  if (couldBecomePrefix(candidate, prefix)) {
    return {
      state: { phase: "holding", held: candidate, line: "" },
      effects: effects({ echo: ch }),
    };
  }

  // It cannot be ours. Erase the local echo and give the shell everything.
  return {
    state: { phase: "passthrough", held: "", line: "" },
    effects: effects({ send: candidate, erase: held.length }),
  };
}

/**
 * Feed a chunk through the machine.
 *
 * xterm batches fast typing and pastes into a single onData call, so chunks
 * must be split. Treating any multi-character payload as a paste sent "dn"
 * straight to the shell the moment someone typed at speed, which is why `dnet`
 * only ever worked when typed slowly.
 *
 * An escape sequence is indivisible and is never a `dnet` line.
 */
export function consumeChunk(
  state: InputState,
  data: string,
  prefix: string,
): { state: InputState; effects: InputEffects[] } {
  if (data.startsWith(ESC)) {
    if (state.phase === "command") return { state, effects: [] };
    return {
      state: { phase: "passthrough", held: "", line: "" },
      effects: [effects({ send: state.held + data, erase: state.held.length })],
    };
  }

  const out: InputEffects[] = [];
  let current = state;
  for (const ch of data) {
    const step = consume(current, ch, prefix);
    current = step.state;
    out.push(step.effects);
  }
  return { state: current, effects: out };
}
