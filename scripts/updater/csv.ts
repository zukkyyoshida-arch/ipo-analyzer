// 区切り文字つきテキスト（CSV・TSV）の小さなパーサ。依存を増やさないための自前実装。
// ダブルクォートで囲んだ値（区切り文字・改行・"" を含む）に対応する。行末は \r\n と \n のどちらでもよい。

/** text を行 × 列の文字列配列にする。空行は捨てる。先頭の BOM は除く。 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (src[i + 1] !== "\n") endRow();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
