/** 問題の CSV の見出し。列の並びもこの順。 */
export const CSV_HEADER = ['問題文', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解'];

export interface CsvRecord {
  /** このレコードが始まる行番号(1始まり)。エラー表示に使う。 */
  line: number;
  cells: string[];
}

/**
 * CSV を読む。引用符で囲んだセルの中のカンマ・改行・「""」に対応する。
 * 先頭の BOM と空行は読み飛ばす。
 */
export function parseCsv(text: string): CsvRecord[] {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false; // 引用符の中にいる
  let line = 1;
  let recordLine = 1;
  const endRecord = () => {
    cells.push(cell);
    if (cells.length > 1 || cells[0] !== '') records.push({ line: recordLine, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRecord();
  return records;
}

const escapeCell = (cell: string): string => (/[",\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell);

/** CSV を書く。行は CRLF で区切る(Excel 向け)。 */
export function formatCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',') + '\r\n').join('');
}
