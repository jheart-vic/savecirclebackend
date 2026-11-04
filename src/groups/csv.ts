export type CsvRow = { line: number; fields: string[] };

/** Splits RFC 4180 CSV text into rows, keeping each row's starting line number. Throws on an unclosed quote. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    fields.push(field);
    rows.push({ line: rowLine, fields });
    fields = [];
    field = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        if (char === "\n") line++;
        field += char;
      }
    } else if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error(`Unclosed quote starting on line ${rowLine}`);
  if (field !== "" || fields.length > 0) endRow();
  return rows;
}
