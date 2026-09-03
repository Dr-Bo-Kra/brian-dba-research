import { EXPORT_COLUMNS } from './constants.mjs';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value) {
  let text = value == null ? '' : String(value);
  if (FORMULA_PREFIX.test(text) || text.startsWith('\u0009')) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(rows, columns = EXPORT_COLUMNS) {
  const header = columns.join(',');
  const lines = [header];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvCell(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function mapExportRow(record) {
  return {
    participant_reference: record.participant_reference || '',
    accepted_at: record.accepted_at || '',
    region: record.region || '',
    role: record.role || '',
    experience: record.experience || '',
    orientation: record.orientation == null ? '' : record.orientation,
  };
}
