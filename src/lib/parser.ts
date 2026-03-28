import type { DealCategory } from '../types';

/**
 * HTMLRewriter-based table parser for cpok.tw promotion pages.
 *
 * Strategy:
 * 1. Identify target tables by checking <th> headers for promotion keywords
 * 2. Collect <td> cell text per <tr> row
 * 3. Skip rows wrapped in <s> / <del> (strikethrough = expired)
 * 4. Must consume transformed response body for handlers to fire
 */
export async function parsePromotionTables(response: Response): Promise<string[][]> {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let headerTexts: string[] = [];
  let inTargetTable = false;
  let inStrikethrough = false;
  let currentCellText = '';

  const rewriter = new HTMLRewriter()
    .on('table', {
      element() {
        // Reset per-table state
        headerTexts = [];
        inTargetTable = false;
      },
    })
    .on('thead th', {
      element(el) {
        el.onEndTag(() => {
          // Check after all text callbacks for this <th> have fired
        });
      },
      text: ({ text }) => {
        headerTexts.push(text.trim());
      },
    })
    .on('thead', {
      element() {},
      onEndTag() {
        // After all <th> collected, check if this is a promotion table
        const headerStr = headerTexts.join('');
        if (
          headerStr.includes('優惠') ||
          headerStr.includes('活動') ||
          headerStr.includes('價')
        ) {
          inTargetTable = true;
        }
      },
    })
    .on('s', {
      element() {
        inStrikethrough = true;
      },
      onEndTag() {
        inStrikethrough = false;
      },
    })
    .on('del', {
      element() {
        inStrikethrough = true;
      },
      onEndTag() {
        inStrikethrough = false;
      },
    })
    .on('tbody tr', {
      element() {
        currentRow = [];
      },
      onEndTag() {
        if (inTargetTable && !inStrikethrough && currentRow.length >= 2) {
          rows.push([...currentRow]);
        }
        currentRow = [];
      },
    })
    .on('td', {
      element() {
        currentCellText = '';
      },
      text: ({ text }) => {
        currentCellText += text;
      },
      onEndTag() {
        const cleaned = currentCellText
          .replace(/👉前往購買/g, '')
          .replace(/查詢限定門市/g, '')
          .trim();
        currentRow.push(cleaned);
      },
    });

  // CRITICAL: Must consume the body for handlers to fire
  await rewriter.transform(response).text();
  return rows;
}
