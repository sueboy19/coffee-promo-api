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
  let rowHadStrikethrough = false;
  let currentCellText = '';

  const rewriter = new HTMLRewriter()
    .on('table', {
      element() {
        headerTexts = [];
        inTargetTable = false;
      },
    })
    .on('thead th', {
      element() {},
      text: ({ text }) => {
        headerTexts.push(text.trim());
      },
    })
    .on('thead', {
      element(el) {
        el.onEndTag(() => {
          const headerStr = headerTexts.join('');
          if (
            headerStr.includes('優惠') ||
            headerStr.includes('活動') ||
            headerStr.includes('價')
          ) {
            inTargetTable = true;
          }
        });
      },
    })
    .on('s', {
      element(el) {
        inStrikethrough = true;
        rowHadStrikethrough = true;
        el.onEndTag(() => {
          inStrikethrough = false;
        });
      },
    })
    .on('del', {
      element(el) {
        inStrikethrough = true;
        rowHadStrikethrough = true;
        el.onEndTag(() => {
          inStrikethrough = false;
        });
      },
    })
    .on('tbody tr', {
      element(el) {
        currentRow = [];
        rowHadStrikethrough = false;
        el.onEndTag(() => {
          if (inTargetTable && !rowHadStrikethrough && currentRow.length >= 2) {
            rows.push([...currentRow]);
          }
          currentRow = [];
        });
      },
    })
    .on('td', {
      element(el) {
        currentCellText = '';
        el.onEndTag(() => {
          const cleaned = currentCellText
            .replace(/👉前往購買/g, '')
            .replace(/查詢限定門市/g, '')
            .trim();
          currentRow.push(cleaned);
        });
      },
      text: ({ text }) => {
        currentCellText += text;
      },
    });

  await rewriter.transform(response).text();
  return rows;
}
