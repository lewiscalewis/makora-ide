import { useMemo, useState } from "react";
import { Table, Search, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface Props {
  content: string;
  path: string;
}

function parseDelimited(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t")
    ? "\t"
    : firstLine.includes(";")
      ? ";"
      : ",";

  const parseLine = (line: string) => {
    const res: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        res.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function parseJsonTable(text: string): { headers: string[]; rows: string[][] } {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      const headers = Object.keys(data[0]);
      const rows = data.map((item) => headers.map((h) => String(item[h] ?? "")));
      return { headers, rows };
    }
  } catch {
    /* fallback to plain */
  }
  return { headers: [], rows: [] };
}

export default function DataGridViewer({ content, path }: Props) {
  const [query, setQuery] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const isJson = path.endsWith(".json");
  const { headers, rows } = useMemo(() => {
    if (isJson) {
      const jsonRes = parseJsonTable(content);
      if (jsonRes.headers.length > 0) return jsonRes;
    }
    return parseDelimited(content);
  }, [content, isJson]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter((row) =>
        row.some((cell) => cell.toLowerCase().includes(q)),
      );
    }
    if (sortCol !== null) {
      result = [...result].sort((a, b) => {
        const valA = a[sortCol] ?? "";
        const valB = b[sortCol] ?? "";
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          return sortAsc ? numA - numB : numB - numA;
        }
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      });
    }
    return result;
  }, [rows, query, sortCol, sortAsc]);

  const toggleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      if (sortAsc) {
        setSortAsc(false);
      } else {
        setSortCol(null);
        setSortAsc(true);
      }
    } else {
      setSortCol(colIdx);
      setSortAsc(true);
    }
  };

  return (
    <div className="multi-mode-viewer data-grid-viewer-wrap">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <Table size={13} className="text-cyan" />
          <span className="viewer-file-tag">Data Grid</span>
          <span className="grid-meta-badge">
            {rows.length} filas × {headers.length} col
          </span>
        </div>
        <div className="viewer-toolbar-center">
          <div className="grid-search-wrap">
            <Search size={11} className="search-icon" />
            <input
              className="grid-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar datos en tiempo real..."
            />
            {query && (
              <button className="clear-filter-btn" onClick={() => setQuery("")}>
                <X size={10} />
              </button>
            )}
          </div>
        </div>
        <div className="viewer-toolbar-right">
          {query && (
            <span className="filter-count-tag">
              {filteredRows.length} coincidencia{filteredRows.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <div className="data-grid-container">
        {headers.length === 0 ? (
          <div className="grid-empty muted">No se pudieron extraer datos tabulares estructurados.</div>
        ) : (
          <table className="data-grid-table">
            <thead>
              <tr>
                <th className="grid-row-num">#</th>
                {headers.map((h, i) => (
                  <th key={i} className="grid-th" onClick={() => toggleSort(i)}>
                    <div className="th-content">
                      <span>{h}</span>
                      <span className="sort-indicator">
                        {sortCol === i ? (
                          sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                        ) : (
                          <ArrowUpDown size={10} className="opacity-40" />
                        )}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 500).map((row, rIdx) => (
                <tr key={rIdx} className="grid-row">
                  <td className="grid-row-num">{rIdx + 1}</td>
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="grid-td" title={row[cIdx] ?? ""}>
                      {row[cIdx] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
