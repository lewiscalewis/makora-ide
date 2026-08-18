import type { DiffLine } from "../types";

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  if (a.length > 1500 || b.length > 1500) {
    const out: DiffLine[] = [];
    a.forEach((l) => out.push({ type: "del", text: l }));
    b.forEach((l) => out.push({ type: "add", text: l }));
    return out;
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ type: "ctx", text: a[i] });
      i++;
      j++;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ type: "add", text: b[j] });
      j++;
    } else {
      out.push({ type: "del", text: a[i] });
      i++;
    }
  }
  return out;
}
