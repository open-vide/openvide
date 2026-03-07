export interface HighlightToken {
  type: "keyword" | "string" | "comment" | "number" | "operator" | "function" | "type" | "punctuation" | "plain";
  text: string;
}

// One Dark color palette
export const ONE_DARK_COLORS: Record<HighlightToken["type"], string> = {
  keyword: "#c678dd",
  string: "#98c379",
  comment: "#5c6370",
  number: "#d19a66",
  operator: "#56b6c2",
  function: "#61afef",
  type: "#e5c07b",
  punctuation: "#abb2bf",
  plain: "#abb2bf",
};

interface LanguageRules {
  keywords: Set<string>;
  types: Set<string>;
  lineComment?: string;
  blockCommentStart?: string;
  blockCommentEnd?: string;
  stringDelimiters: string[];
  templateLiteral?: boolean;
}

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends", "finally",
  "for", "from", "function", "if", "import", "in", "instanceof", "let", "new",
  "of", "return", "static", "super", "switch", "this", "throw", "try", "typeof",
  "var", "void", "while", "with", "yield",
]);

const JS_TYPES = new Set([
  "Array", "Boolean", "Date", "Error", "Function", "Map", "Number", "Object",
  "Promise", "RegExp", "Set", "String", "Symbol", "WeakMap", "WeakSet",
  "null", "undefined", "true", "false", "NaN", "Infinity",
]);

const TS_TYPES = new Set([
  ...JS_TYPES,
  "any", "boolean", "bigint", "never", "number", "object", "string",
  "symbol", "unknown", "void", "enum", "interface", "type", "namespace",
  "abstract", "as", "implements", "is", "keyof", "readonly",
]);

const PY_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass",
  "raise", "return", "try", "while", "with", "yield",
]);

const PY_TYPES = new Set([
  "True", "False", "None", "int", "float", "str", "bool", "list", "dict",
  "tuple", "set", "bytes", "type", "object", "range", "self",
]);

const GO_KEYWORDS = new Set([
  "break", "case", "chan", "const", "continue", "default", "defer", "else",
  "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
  "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
]);

const GO_TYPES = new Set([
  "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
  "int", "int8", "int16", "int32", "int64", "rune", "string",
  "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
  "true", "false", "nil", "iota", "append", "cap", "close", "copy",
  "delete", "len", "make", "new", "panic", "print", "println", "recover",
]);

const RUST_KEYWORDS = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn",
  "else", "enum", "extern", "fn", "for", "if", "impl", "in", "let",
  "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
  "self", "static", "struct", "super", "trait", "type", "unsafe",
  "use", "where", "while", "yield",
]);

const RUST_TYPES = new Set([
  "bool", "char", "f32", "f64", "i8", "i16", "i32", "i64", "i128",
  "isize", "str", "u8", "u16", "u32", "u64", "u128", "usize",
  "String", "Vec", "Option", "Result", "Box", "Rc", "Arc",
  "true", "false", "None", "Some", "Ok", "Err", "Self",
]);

const C_KEYWORDS = new Set([
  "auto", "break", "case", "char", "const", "continue", "default", "do",
  "double", "else", "enum", "extern", "float", "for", "goto", "if",
  "inline", "int", "long", "register", "restrict", "return", "short",
  "signed", "sizeof", "static", "struct", "switch", "typedef", "union",
  "unsigned", "void", "volatile", "while",
]);

const C_TYPES = new Set([
  "NULL", "true", "false", "size_t", "int8_t", "int16_t", "int32_t",
  "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
  "bool", "FILE", "stdin", "stdout", "stderr",
]);

const RUBY_KEYWORDS = new Set([
  "alias", "and", "begin", "break", "case", "class", "def", "defined?",
  "do", "else", "elsif", "end", "ensure", "for", "if", "in",
  "module", "next", "not", "or", "redo", "rescue", "retry", "return",
  "self", "super", "then", "undef", "unless", "until", "when", "while", "yield",
]);

const RUBY_TYPES = new Set([
  "true", "false", "nil", "Array", "Hash", "String", "Integer", "Float",
  "Symbol", "Proc", "Lambda", "Class", "Module", "Object",
]);

const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while",
]);

const JAVA_TYPES = new Set([
  "true", "false", "null", "String", "Integer", "Boolean", "Double", "Float",
  "Long", "Short", "Byte", "Character", "Object", "Class", "System",
  "List", "Map", "Set", "ArrayList", "HashMap", "HashSet",
]);

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "and", "or", "not", "in", "is", "null",
  "like", "between", "exists", "insert", "into", "values", "update", "set",
  "delete", "create", "table", "alter", "drop", "index", "view", "join",
  "inner", "left", "right", "outer", "on", "as", "order", "by", "group",
  "having", "limit", "offset", "union", "all", "distinct", "case", "when",
  "then", "else", "end", "primary", "key", "foreign", "references",
  "constraint", "default", "check", "unique", "cascade", "begin",
  "commit", "rollback", "transaction", "grant", "revoke", "with",
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "IS", "NULL",
  "LIKE", "BETWEEN", "EXISTS", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "VIEW", "JOIN",
  "INNER", "LEFT", "RIGHT", "OUTER", "ON", "AS", "ORDER", "BY", "GROUP",
  "HAVING", "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "CASE", "WHEN",
  "THEN", "ELSE", "END", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
]);

const SQL_TYPES = new Set([
  "int", "integer", "bigint", "smallint", "tinyint", "decimal", "numeric",
  "float", "real", "double", "char", "varchar", "text", "blob", "date",
  "time", "datetime", "timestamp", "boolean", "serial",
  "INT", "INTEGER", "BIGINT", "SMALLINT", "VARCHAR", "TEXT", "BOOLEAN",
]);

const BASH_KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
  "case", "esac", "in", "function", "return", "local", "export",
  "source", "alias", "unalias", "readonly", "declare", "typeset",
  "select", "until", "shift", "trap", "break", "continue", "exit",
]);

const BASH_TYPES = new Set([
  "true", "false", "echo", "printf", "read", "test", "cd", "pwd",
  "ls", "cp", "mv", "rm", "mkdir", "rmdir", "cat", "grep", "sed",
  "awk", "find", "sort", "uniq", "wc", "head", "tail", "chmod",
  "chown", "curl", "wget", "ssh", "scp", "git", "npm", "yarn",
  "node", "python", "pip", "docker", "sudo", "apt", "yum", "brew",
]);

const HTML_KEYWORDS = new Set([
  "html", "head", "body", "div", "span", "p", "a", "img", "ul", "ol",
  "li", "table", "tr", "td", "th", "form", "input", "button", "select",
  "option", "textarea", "label", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "footer", "nav", "main", "section", "article", "aside",
  "script", "style", "link", "meta", "title", "br", "hr",
]);

const CSS_KEYWORDS = new Set([
  "display", "position", "top", "right", "bottom", "left", "width", "height",
  "margin", "padding", "border", "background", "color", "font", "text",
  "flex", "grid", "align", "justify", "overflow", "opacity", "transform",
  "transition", "animation", "z-index", "cursor", "visibility",
  "important", "none", "auto", "inherit", "initial", "unset",
]);

const YAML_KEYWORDS = new Set(["true", "false", "null", "yes", "no", "on", "off"]);

const LANGUAGES: Record<string, LanguageRules> = {
  javascript: { keywords: JS_KEYWORDS, types: JS_TYPES, lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ["'", '"', "`"], templateLiteral: true },
  typescript: { keywords: new Set([...JS_KEYWORDS, "type", "interface", "enum", "namespace", "abstract", "as", "implements", "is", "keyof", "readonly", "declare", "module", "infer", "override", "satisfies"]), types: TS_TYPES, lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ["'", '"', "`"], templateLiteral: true },
  python: { keywords: PY_KEYWORDS, types: PY_TYPES, lineComment: "#", stringDelimiters: ["'", '"', '"""', "'''"] },
  bash: { keywords: BASH_KEYWORDS, types: BASH_TYPES, lineComment: "#", stringDelimiters: ["'", '"'] },
  json: { keywords: new Set(), types: new Set(["true", "false", "null"]), stringDelimiters: ['"'] },
  yaml: { keywords: YAML_KEYWORDS, types: new Set(), lineComment: "#", stringDelimiters: ["'", '"'] },
  go: { keywords: GO_KEYWORDS, types: GO_TYPES, lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ['"', "`", "'"] },
  rust: { keywords: RUST_KEYWORDS, types: RUST_TYPES, lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ['"'] },
  c: { keywords: C_KEYWORDS, types: C_TYPES, lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ['"', "'"] },
  html: { keywords: HTML_KEYWORDS, types: new Set(), blockCommentStart: "<!--", blockCommentEnd: "-->", stringDelimiters: ["'", '"'] },
  css: { keywords: CSS_KEYWORDS, types: new Set(), blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ["'", '"'] },
  sql: { keywords: SQL_KEYWORDS, types: SQL_TYPES, lineComment: "--", blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ["'"] },
  ruby: { keywords: RUBY_KEYWORDS, types: RUBY_TYPES, lineComment: "#", stringDelimiters: ["'", '"'] },
  java: { keywords: JAVA_KEYWORDS, types: JAVA_TYPES, lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", stringDelimiters: ["'", '"'] },
  markdown: { keywords: new Set(), types: new Set(), stringDelimiters: [] },
  diff: { keywords: new Set(), types: new Set(), stringDelimiters: [] },
};

// Aliases
LANGUAGES["js"] = LANGUAGES["javascript"]!;
LANGUAGES["ts"] = LANGUAGES["typescript"]!;
LANGUAGES["tsx"] = LANGUAGES["typescript"]!;
LANGUAGES["jsx"] = LANGUAGES["javascript"]!;
LANGUAGES["py"] = LANGUAGES["python"]!;
LANGUAGES["sh"] = LANGUAGES["bash"]!;
LANGUAGES["shell"] = LANGUAGES["bash"]!;
LANGUAGES["zsh"] = LANGUAGES["bash"]!;
LANGUAGES["yml"] = LANGUAGES["yaml"]!;
LANGUAGES["cpp"] = LANGUAGES["c"]!;
LANGUAGES["cc"] = LANGUAGES["c"]!;
LANGUAGES["h"] = LANGUAGES["c"]!;
LANGUAGES["hpp"] = LANGUAGES["c"]!;
LANGUAGES["rb"] = LANGUAGES["ruby"]!;
LANGUAGES["htm"] = LANGUAGES["html"]!;
LANGUAGES["xml"] = LANGUAGES["html"]!;
LANGUAGES["svg"] = LANGUAGES["html"]!;

const EXT_MAP: Record<string, string> = {
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".py": "python", ".pyw": "python",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".json": "json", ".jsonc": "json",
  ".yaml": "yaml", ".yml": "yaml",
  ".go": "go",
  ".rs": "rust",
  ".c": "c", ".h": "c", ".cpp": "c", ".cc": "c", ".hpp": "c",
  ".html": "html", ".htm": "html", ".xml": "html", ".svg": "html",
  ".css": "css", ".scss": "css", ".less": "css",
  ".sql": "sql",
  ".rb": "ruby",
  ".java": "java",
  ".md": "markdown", ".mdx": "markdown",
  ".diff": "diff", ".patch": "diff",
};

export function inferLanguageFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = filePath.slice(dot).toLowerCase();
  return EXT_MAP[ext] ?? "";
}

function tokenizeDiffLine(line: string): HighlightToken[] {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return [{ type: "function", text: line }];
  }
  if (line.startsWith("@@")) {
    return [{ type: "keyword", text: line }];
  }
  if (line.startsWith("+")) {
    return [{ type: "string", text: line }];
  }
  if (line.startsWith("-")) {
    return [{ type: "operator", text: line }];
  }
  return [{ type: "plain", text: line }];
}

function tokenizeLine(line: string, rules: LanguageRules): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let i = 0;

  while (i < line.length) {
    // Line comment
    if (rules.lineComment && line.startsWith(rules.lineComment, i)) {
      tokens.push({ type: "comment", text: line.slice(i) });
      return tokens;
    }

    // Block comment start on same line
    if (rules.blockCommentStart && line.startsWith(rules.blockCommentStart, i)) {
      const endIdx = line.indexOf(rules.blockCommentEnd ?? "", i + rules.blockCommentStart.length);
      if (endIdx >= 0 && rules.blockCommentEnd) {
        const end = endIdx + rules.blockCommentEnd.length;
        tokens.push({ type: "comment", text: line.slice(i, end) });
        i = end;
        continue;
      }
      tokens.push({ type: "comment", text: line.slice(i) });
      return tokens;
    }

    // Strings
    let matchedString = false;
    for (const delim of rules.stringDelimiters) {
      if (line.startsWith(delim, i)) {
        let end = i + delim.length;
        while (end < line.length) {
          if (line[end] === "\\" && delim !== "`") {
            end += 2;
            continue;
          }
          if (line.startsWith(delim, end)) {
            end += delim.length;
            break;
          }
          end++;
        }
        tokens.push({ type: "string", text: line.slice(i, end) });
        i = end;
        matchedString = true;
        break;
      }
    }
    if (matchedString) continue;

    // Numbers
    if (/[0-9]/.test(line[i]!) && (i === 0 || !/[a-zA-Z_$]/.test(line[i - 1] ?? ""))) {
      let end = i + 1;
      while (end < line.length && /[0-9a-fA-FxXoObBeE._]/.test(line[end]!)) {
        end++;
      }
      tokens.push({ type: "number", text: line.slice(i, end) });
      i = end;
      continue;
    }

    // Words (identifiers/keywords)
    if (/[a-zA-Z_$]/.test(line[i]!)) {
      let end = i + 1;
      while (end < line.length && /[a-zA-Z0-9_$?]/.test(line[end]!)) {
        end++;
      }
      const word = line.slice(i, end);

      // Check if it's a function call (followed by `(`)
      let afterWord = end;
      while (afterWord < line.length && line[afterWord] === " ") afterWord++;

      if (rules.keywords.has(word)) {
        tokens.push({ type: "keyword", text: word });
      } else if (rules.types.has(word)) {
        tokens.push({ type: "type", text: word });
      } else if (afterWord < line.length && line[afterWord] === "(") {
        tokens.push({ type: "function", text: word });
      } else {
        tokens.push({ type: "plain", text: word });
      }
      i = end;
      continue;
    }

    // Operators
    if (/[+\-*/%=<>!&|^~?:]/.test(line[i]!)) {
      let end = i + 1;
      while (end < line.length && /[+\-*/%=<>!&|^~?:]/.test(line[end]!)) {
        end++;
      }
      tokens.push({ type: "operator", text: line.slice(i, end) });
      i = end;
      continue;
    }

    // Punctuation
    if (/[{}()[\],;.]/.test(line[i]!)) {
      tokens.push({ type: "punctuation", text: line[i]! });
      i++;
      continue;
    }

    // Whitespace and other
    let end = i + 1;
    while (end < line.length && !/[a-zA-Z0-9_$+\-*/%=<>!&|^~?:{}()[\],;."'`#]/.test(line[end]!)) {
      end++;
    }
    tokens.push({ type: "plain", text: line.slice(i, end) });
    i = end;
  }

  return tokens;
}

export function tokenize(code: string, language: string): HighlightToken[][] {
  const lang = language.toLowerCase();
  const lines = code.split("\n");

  if (lang === "diff") {
    return lines.map(tokenizeDiffLine);
  }

  const rules = LANGUAGES[lang];
  if (!rules) {
    return lines.map((line) => [{ type: "plain" as const, text: line }]);
  }

  return lines.map((line) => tokenizeLine(line, rules));
}
