import { describe, it, expect } from 'vitest';
import { parsePromotionTables } from '../src/lib/parser';

function makeHtml(body: string): Response {
  return new Response(`<!DOCTYPE html><html><body>${body}</body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

describe('parsePromotionTables', () => {
  it('parses a standard promotion table', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>優惠項目</th><th>優惠價</th><th>活動時間</th></tr></thead>
        <tbody>
          <tr><td>特大冰濃萃美式咖啡</td><td>買一送一</td><td>2026/1/5~2/6</td></tr>
          <tr><td>大杯精品美式</td><td>買2送2</td><td>2026/1/7~1/20</td></tr>
        </tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['特大冰濃萃美式咖啡', '買一送一', '2026/1/5~2/6']);
    expect(rows[1]).toEqual(['大杯精品美式', '買2送2', '2026/1/7~1/20']);
  });

  it('skips rows fully wrapped in <s> tag', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>優惠項目</th><th>優惠價</th><th>活動時間</th></tr></thead>
        <tbody>
          <tr><s><td>過期咖啡</td><td>買一送一</td><td>2025/1/1~1/31</td></s></tr>
          <tr><td>新咖啡</td><td>買一送一</td><td>2026/1/5~2/6</td></tr>
        </tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('新咖啡');
  });

  it('skips rows fully wrapped in <del> tag', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>優惠項目</th><th>優惠價</th><th>活動時間</th></tr></thead>
        <tbody>
          <tr><del><td>過期咖啡</td><td>買一送一</td><td>2025/1/1~1/31</td></del></tr>
        </tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows).toHaveLength(0);
  });

  it('does skip rows with <s> only inside individual cells', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>優惠項目</th><th>優惠價</th></tr></thead>
        <tbody>
          <tr><td><s>過期</s></td><td><s>買一送一</s></td></tr>
          <tr><td>新咖啡</td><td>買一送一</td></tr>
        </tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('新咖啡');
  });

  it('ignores tables without promotion-related headers', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>店名</th><th>地址</th></tr></thead>
        <tbody>
          <tr><td>某店</td><td>某地址</td></tr>
        </tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows).toHaveLength(0);
  });

  it('skips rows with fewer than 2 cells', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>優惠項目</th><th>優惠價</th></tr></thead>
        <tbody>
          <tr><td>單欄位</td></tr>
          <tr><td>咖啡</td><td>買一送一</td></tr>
        </tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['咖啡', '買一送一']);
  });

  it('strips 👉前往購買 and 查詢限定門市 from cells', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>優惠項目</th><th>優惠價</th><th>活動時間</th></tr></thead>
        <tbody>
          <tr><td>美式咖啡👉前往購買</td><td>買一送一查詢限定門市</td><td>2026/1/5~2/6</td></tr>
        </tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows[0][0]).toBe('美式咖啡');
    expect(rows[0][1]).toBe('買一送一');
  });

  it('handles multiple tables on a page', async () => {
    const html = makeHtml(`
      <table>
        <thead><tr><th>店名</th><th>地址</th></tr></thead>
        <tbody><tr><td>某店</td><td>某地址</td></tr></tbody>
      </table>
      <table>
        <thead><tr><th>優惠項目</th><th>優惠價</th><th>活動時間</th></tr></thead>
        <tbody><tr><td>拿鐵</td><td>買一送一</td><td>2026/1/5~2/6</td></tr></tbody>
      </table>
    `);

    const rows = await parsePromotionTables(html);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('拿鐵');
  });
});
