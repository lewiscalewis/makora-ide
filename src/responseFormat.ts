const FENCE_RE =
  /(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?=\n\2[^\S\n]*(?:\n|$)|\s*$)/g;

const PLACEHOLDER_PREFIX = "\uE000";
const PLACEHOLDER_SUFFIX = "\uE001";

interface FenceStash {
  body: string;
  blocks: string[];
}

function protectFences(text: string): FenceStash {
  const blocks: string[] = [];
  const body = text.replace(FENCE_RE, (full, pre: string, _marker: string) => {
    const idx = blocks.length;
    blocks.push(full);
    return `${pre}${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
  });
  return { body, blocks };
}

function restoreFences(stash: FenceStash, currentBody: string): string {
  return currentBody.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g"),
    (_m, i: string) => stash.blocks[Number(i)] ?? "",
  );
}

function normalizeDsmlNamespace(s: string): string {
  // Colapsa el namespace DSML a su forma canónica de UNA tubería: DeepSeek emite
  // `<||DSML||…>` (dos tuberías) y variantes (ancho completo, HTML-escaped,
  // espacios). Sin esto los regex de abajo no casan y el XML crudo se filtra.
  return s
    .replace(/(<\s*\/?\s*)\|+\s*DSML\s*\|+/gi, "$1|DSML|")
    .replace(/(&lt;\s*\/?\s*)\|+\s*DSML\s*\|+/gi, "$1|DSML|");
}

const ANSI_RE =
  /[\u001B\u009B](?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\([A-Z0-9]|[@-Z\\_])/g;

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u061C]/g;
const INVISIBLE = /[\u200B\u2060\u00AD]/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LONE_SURROGATES =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const TOOL_TAG_NAMES =
  "invoke|parameter|tool_call|tool_use|function_calls|tool_calls|thought|thinking|reasoning|scratchpad|analysis|search|search_results|result|attempt";

const CLOSED_PAIR_RES: RegExp[] = [
  /<\s*\|\s*DSML\s*\|\s*tool_calls\s*>[\s\S]*?<\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/gi,
  /<\s*\|\s*DSML\s*\|\s*invoke\b[^>]*>[\s\S]*?<\s*\/\s*\|\s*DSML\s*\|\s*invoke\s*>/gi,
  /<\s*function_calls\s*>[\s\S]*?<\s*\/\s*function_calls\s*>/gi,
  /<\s*(?:invoke|parameter|tool_call|tool_use)\b[^>]*>[\s\S]*?<\s*\/\s*(?:invoke|parameter|tool_call|tool_use)\s*>/gi,
  /<\s*(?:thought|thinking|reasoning|scratchpad|analysis|search|search_results|result|attempt)\b[^>]*>[\s\S]*?<\s*\/\s*(?:thought|thinking|reasoning|scratchpad|analysis|search|search_results|result|attempt)\s*>/gi,
  /<\|(?:tool_call|tool_use)\|>[\s\S]*?<\/\|(?:tool_call|tool_use)\|>/gi,
  /&lt;\s*function_calls\s*&gt;[\s\S]*?&lt;\s*\/\s*function_calls\s*&gt;/gi,
];

const SELF_CLOSED_RES: RegExp[] = [
  /<\s*(?:invoke|parameter|tool_call|tool_use|function_calls)\b[^>]*\/\s*>/gi,
];

const STRAY_CLOSE_RES: RegExp[] = [
  new RegExp(`<\\/\\s*(?:${TOOL_TAG_NAMES})\\s*>`, "gi"),
  /<\/\s*\|\s*DSML\s*\|\s*(?:invoke|tool_calls)\s*>/gi,
];

const TOKEN_RES: RegExp[] = [
  /\[(?:toolu_bdrk_[A-Za-z0-9]+|tool_use|tool_result|tool_call)\]/g,
  /<\|(?:python_tag|fim_prefix|fim_suffix|fim_middle|endoftext|im_start|im_end)\|>/gi,
  /&lt;\s*\|\s*DSML\s*\|\s*tool_calls\s*&gt;/gi,
  /&lt;\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*&gt;/gi,
];

const UNCLOSED_RULES: Array<{ open: RegExp; close: RegExp }> = [
  {
    open: /<\s*\|\s*DSML\s*\|\s*tool_calls\s*>/g,
    close: /<\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/i,
  },
  {
    open: /<\s*\|\s*DSML\s*\|\s*invoke\b[^>]*>/g,
    close: /<\s*\/\s*\|\s*DSML\s*\|\s*invoke\s*>/i,
  },
  {
    open: /<\s*\|?\s*tool_call\s*\|?>/g,
    close: /<\/\s*\|?\s*tool_call\s*\|?>/i,
  },
  {
    open: /<\s*function_calls\s*>/g,
    close: /<\s*\/\s*function_calls\s*>/i,
  },
  {
    open: /<\s*(?:invoke|parameter)\b[^>]*>/g,
    close: /<\s*\/\s*(?:invoke|parameter)\s*>/i,
  },
  {
    open: /<\s*tool_call\b[^>]*>/g,
    close: /<\s*\/\s*tool_call\s*>/i,
  },
  {
    open: /<\s*(?:thought|thinking|reasoning|scratchpad|analysis|search|search_results|result|attempt)\b[^>]*>/g,
    close: /<\s*\/\s*(?:thought|thinking|reasoning|scratchpad|analysis|search|search_results|result|attempt)\s*>/i,
  },
];

function cutAtLastUnclosed(text: string, openRe: RegExp, closeRe: RegExp): string {
  openRe.lastIndex = 0;
  let lastIndex = -1;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text)) !== null) {
    if (m.index !== undefined) lastIndex = m.index;
  }
  if (lastIndex < 0) return text;
  const tail = text.slice(lastIndex);
  if (closeRe.test(tail)) return text;
  return text.slice(0, lastIndex);
}

function lineAlone(text: string, start: number, end: number): boolean {
  let i = start - 1;
  while (i >= 0 && text[i] !== "\n") {
    if (text[i] !== " " && text[i] !== "\t") return false;
    i--;
  }
  let j = end;
  while (j < text.length && text[j] !== "\n") {
    if (text[j] !== " " && text[j] !== "\t") return false;
    j++;
  }
  return true;
}

function replaceToolBlock(text: string, re: RegExp): string {
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    if (lineAlone(text, start, end)) {
      let lineStart = start;
      let lineEnd = end;
      let i = start - 1;
      while (i >= 0 && text[i] !== "\n") i--;
      lineStart = i + 1;
      let j = end;
      while (j < text.length && text[j] !== "\n") j++;
      lineEnd = j < text.length ? j + 1 : text.length;
      out += text.slice(last, lineStart);
      last = lineEnd;
    } else {
      out += text.slice(last, start) + " ";
      last = end;
    }
  }
  out += text.slice(last);
  return out;
}

export function stripToolSyntax(t: string): string {
  let s = normalizeDsmlNamespace(t);
  for (let i = 0; i < 15; i++) {
    let next = s;
    let changed = false;
    for (const re of CLOSED_PAIR_RES) {
      const replaced = replaceToolBlock(next, re);
      changed = changed || replaced !== next;
      next = replaced;
    }
    for (const re of SELF_CLOSED_RES) {
      const replaced = replaceToolBlock(next, re);
      changed = changed || replaced !== next;
      next = replaced;
    }
    for (const rule of UNCLOSED_RULES) {
      const cut = cutAtLastUnclosed(next, rule.open, rule.close);
      changed = changed || cut !== next;
      next = cut;
    }
    for (const re of STRAY_CLOSE_RES) {
      const replaced = replaceToolBlock(next, re);
      changed = changed || replaced !== next;
      next = replaced;
    }
    for (const re of TOKEN_RES) {
      const replaced = replaceToolBlock(next, re);
      changed = changed || replaced !== next;
      next = replaced;
    }
    if (changed) next = next.replace(/[ \t]{2,}/g, " ");
    if (next === s) break;
    s = next;
  }
  return s;
}

export function cleanUnicode(t: string): string {
  let s = t.replace(/\r\n?/g, "\n");
  s = s
    .replace(/[\uFF5C]/g, "|")
    .replace(/[\uFF1C]/g, "<")
    .replace(/[\uFF1E]/g, ">")
    .replace(/[\uFF3B]/g, "[")
    .replace(/[\uFF3D]/g, "]");
  s = s.replace(ANSI_RE, "");
  s = s
    .replace(CONTROL_CHARS, "")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/\uFEFF/g, "")
    .replace(BIDI_CONTROLS, "")
    .replace(INVISIBLE, "");
  s = s.replace(LONE_SURROGATES, "\uFFFD");
  try {
    s = s.normalize("NFC");
  } catch {
    /* noop */
  }
  return s;
}

export const TOOL_ONLY_NOTE = "⚙️ _El modelo intentó ejecutar herramientas en esta respuesta._";

export function formatResponse(raw: unknown): string {
  if (typeof raw !== "string") return "";
  if (raw.length === 0) return "";
  const hadVisibleContent = /\S/.test(raw);
  const cleaned = cleanUnicode(raw);
  const stash = protectFences(cleaned);
  const stripped = stripToolSyntax(stash.body);
  const core = restoreFences(stash, stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (core.length > 0) return core;
  return hadVisibleContent ? TOOL_ONLY_NOTE : "";
}
