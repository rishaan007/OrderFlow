// RFC-4180 Compliant CSV Generation Utility
// Supports UTF-8 BOM, automatic escaping, and typed dataset formatting

export function formatCsvValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);

  // If the value contains commas, double quotes, or newlines, quote it
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(formatCsvValue).join(",");
  const dataLines = rows.map((row) => row.map(formatCsvValue).join(","));
  // Prepend UTF-8 BOM for Microsoft Excel compatibility
  return "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
}

export function createCsvResponse(csvContent: string, filename: string): Response {
  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}
