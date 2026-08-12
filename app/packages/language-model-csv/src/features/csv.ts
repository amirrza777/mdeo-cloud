/**
 * Parses CSV text into rows of fields, honouring RFC 4180 quoting: quoted fields
 * may contain commas and newlines, and `""` inside a quoted field is an escaped
 * literal quote. Blank lines are skipped.
 *
 * @param text The raw CSV file content
 * @returns The parsed rows, each an array of field values
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let inQuotes = false;
    let i = 0;

    const endField = () => {
        currentRow.push(currentField);
        currentField = "";
    };

    const endRow = () => {
        endField();
        if (!(currentRow.length === 1 && currentRow[0].trim() === "")) {
            rows.push(currentRow);
        }
        currentRow = [];
    };

    while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                currentField += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === ",") {
                endField();
            } else if (c === "\r") {
                // skip
            } else if (c === "\n") {
                endRow();
            } else {
                currentField += c;
            }
        }
        i++;
    }

    if (currentField !== "" || currentRow.length > 0) {
        endRow();
    }

    return rows;
}
