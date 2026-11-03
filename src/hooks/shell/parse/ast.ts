// The shell grammar as the hooks read it: what runs, in which shell, with which words.

export interface Word {
  // The word after quote removal; a command substitution reads as $().
  readonly text: string;
  // Command and process substitutions inside the word, each run in a subshell.
  readonly nested: readonly List[];
  // Where text holds a $NAME or ${NAME} the shell expands (not one in single quotes).
  readonly params: readonly Param[];
}

export interface Param {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export interface Redirect {
  readonly op: string;
  readonly fd: string;
  readonly target: Word;
  // A here-document's body, filled in once the line that opened it ends.
  body: Word | undefined;
}

export type Command =
  | {
      readonly kind: "simple";
      readonly assigns: readonly Word[];
      readonly words: readonly Word[];
      readonly redirects: readonly Redirect[];
    }
  | {
      readonly kind: "subshell" | "group";
      readonly body: List;
      readonly redirects: readonly Redirect[];
    }
  | {
      // if, while, until, for, select, case, [[ ]] and (( )): every list the keyword may run
      // in the current shell, and every word it expands.
      readonly kind: "compound";
      readonly keyword: string;
      // The name for and select assign each item to.
      readonly variable?: string;
      readonly parts: readonly List[];
      readonly words: readonly Word[];
      readonly redirects: readonly Redirect[];
    }
  | {
      readonly kind: "function";
      readonly name: string;
      readonly body: Command;
    };

export interface Pipeline {
  readonly negated: boolean;
  readonly commands: readonly Command[];
}

// Pipelines joined by && and ||; operators[i] sits between pipelines[i] and pipelines[i + 1].
export interface Item {
  readonly pipelines: readonly Pipeline[];
  readonly operators: readonly string[];
  readonly background: boolean;
}

export type List = readonly Item[];
