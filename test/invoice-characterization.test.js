'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

function mixedRateOrder() {
  // Checkout saves the HSN on each line without a gstRate field.
  return {
    id: 42,
    date: '26/11/2026',
    status: 'completed',
    coupon: 'SAVE10',
    items: [
      { id: 1, sku: 'RICE', name: 'Rice', hsn: '1006', price: 500, qty: 2 },
      { id: 2, sku: 'GHEE', name: 'Ghee', hsn: '0405', price: 1000, qty: 1 }
    ],
    subtotal: 2000,
    discount: 150,
    tax: 157.25,
    total: 2007.25
  };
}

test('checkout caps SAVE10 and applies each HSN rate after the allocated discount', () => {
  const order = mixedRateOrder();
  const { lines, ...totals } = pricing.computeTotals(order.items, order.coupon);

  assert.deepEqual(totals, {
    subtotal: 2000, discount: 150, taxable: 1850,
    tax: 157.25, cgst: 78.63, sgst: 78.62, total: 2007.25
  });
  assert.deepEqual(lines.map(({ gstPercent, discount, taxable, tax }) => (
    { gstPercent, discount, taxable, tax }
  )), [
    { gstPercent: 5, discount: 75, taxable: 925, tax: 46.25 },
    { gstPercent: 12, discount: 75, taxable: 925, tax: 111 }
  ]);
});

test('invoice uses checkout rate handling for percentage, decimal, and zero rates', () => {
  const items = [5, 0.05, 0].map(gstRate => ({ price: 100, qty: 1, gstRate }));
  const printed = invoice.computeInvoiceFigures({ items });

  assert.deepEqual(printed.rows.map(row => row.lineTax), [5, 5, 0]);
  assert.equal(printed.tax, 10);
});

test('invoice GST is the sum of rounded line GST', () => {
  const items = [{ price: 1.03, qty: 1 }, { price: 1.03, qty: 1 }];
  const printed = invoice.computeInvoiceFigures({ items });

  assert.deepEqual(printed.rows.map(row => row.lineTax), [0.19, 0.19]);
  assert.equal(printed.tax, 0.38);
  assert.equal(printed.cgst, 0.19);
  assert.equal(printed.sgst, 0.19);
});

test('historical invoice preserves billed figures when line GST cannot be reconstructed', () => {
  const order = { ...mixedRateOrder(), discount: 200, tax: 153, total: 1953 };
  const figures = invoice.computeInvoiceFigures(order);
  const html = invoice.render(order);

  assert.equal(figures.discount, 200);
  assert.equal(figures.tax, 153);
  assert.equal(figures.total, 1953);
  assert.deepEqual(figures.rows.map(row => row.lineTax), [null, null]);
  assert.match(html, /GST by line is unavailable/);
});

test('reconciliation matches invoice figures to the amounts billed', () => {
  const report = reports.getGstReconciliation({ orders: [mixedRateOrder()] });

  assert.equal(report.totalChecked, 1);
  assert.equal(report.mismatchCount, 0);
  assert.equal(report.totalDelta, 0);
  const [{ matched, delta, ledgerTax, invoiceTax }] = report.rows;
  assert.deepEqual({ matched, delta, ledgerTax, invoiceTax }, {
    matched: true, delta: 0, ledgerTax: 157.25, invoiceTax: 157.25
  });
});

test('invoice renders the billed total and GST with the checkout line breakdown', () => {
  const order = mixedRateOrder();
  const figures = invoice.computeInvoiceFigures(order);
  const html = invoice.render(order);

  assert.equal(figures.total, order.total);
  assert.equal(figures.tax, order.tax);
  assert.deepEqual([figures.cgst, figures.sgst], [78.63, 78.62]);
  assert.deepEqual(figures.rows.map(({ gstPercent, lineTax }) => [gstPercent, lineTax]), [
    [5, 46.25],
    [12, 111]
  ]);
  assert.match(html, /Total GST\)<\/td><td class="r">₹157\.25/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹2007\.25/);
  assert.match(html, /CGST<\/td><td class="r">₹78\.63/);
  assert.match(html, /SGST<\/td><td class="r">₹78\.62/);
  assert.doesNotMatch(html, /GST by line is unavailable/);
});
