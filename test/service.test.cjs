const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../electron/db.cjs');
const { createService } = require('../electron/service.cjs');

async function setup() {
  const svc = createService(await openDb(null));
  const call = (m, ...a) => svc.call(m, a);
  await call('login', 'admin', 'admin123');
  const pid = await call('products.save', { sku: 'A1', name: 'Refresco', price: 20, cost: 10, stock: 10, min_stock: 3 });
  const cid = await call('customers.save', { name: 'Juan', phone: '5551234567', credit_limit: 100, credit_days: 7 });
  await call('users.save', { username: 'caja', name: 'Cajero', role: 'cashier', password: 'x1', active: true });
  return { call, pid, cid };
}

test('venta en efectivo descuenta stock y entra al corte', async () => {
  const { call, pid } = await setup();
  await call('sales.create', { items: [{ product_id: pid, qty: 2 }], payments: [{ method: 'cash', amount: 40 }] });
  assert.equal((await call('products.list', 'Refresco'))[0].stock, 8);
  assert.equal((await call('reports.cashClose', {})).total, 40);
});

test('fiar: límite, permisos de cajero, abonos y cartera vencida', async () => {
  const { call, pid, cid } = await setup();
  const sale = (extra) => call('sales.create', { items: [{ product_id: pid, qty: 2 }], customer_id: cid, payments: [{ method: 'credit', amount: 40 }], ...extra });
  await call('logout');
  await call('login', 'caja', 'x1');
  await assert.rejects(sale(), /supervisor/);
  await sale({ supervisor: { username: 'admin', password: 'admin123' } });
  await assert.rejects(sale({ supervisor: { username: 'admin', password: 'bad' } }), /supervisor/);
  assert.equal((await call('customers.list', 'Juan'))[0].balance, 40);
  await assert.rejects(call('credit.abono', { customer_id: cid, amount: 50, method: 'cash' }), /excede/);
  assert.equal(await call('credit.abono', { customer_id: cid, amount: 15, method: 'cash' }), 25);
  const st = await call('credit.statement', cid);
  assert.match(st.text, /Saldo actual: \$25\.00/);
  assert.match(st.whatsappUrl, /wa\.me\/525551234567/);
  await assert.rejects(call('credit.overdue'), /permiso/);
});

test('límite de crédito se respeta y el fiado no entra al corte', async () => {
  const { call, pid, cid } = await setup();
  await assert.rejects(call('sales.create', { items: [{ product_id: pid, qty: 6 }], customer_id: cid, payments: [{ method: 'credit', amount: 120 }] }), /límite/);
  await call('sales.create', { items: [{ product_id: pid, qty: 1 }], customer_id: cid, payments: [{ method: 'credit', amount: 20 }] });
  const cc = await call('reports.cashClose', {});
  assert.equal(cc.total, 0);
  assert.equal(cc.creditSales, 20);
});

test('préstamos: requieren supervisor, no afectan caja, devolución repone stock', async () => {
  const { call, pid, cid } = await setup();
  await call('logout');
  await call('login', 'caja', 'x1');
  const loan = { product_id: pid, customer_id: cid, qty: 3, due_date: '2000-01-01T00:00:00.000Z' };
  await assert.rejects(call('loans.create', loan), /supervisor/);
  const id = await call('loans.create', { ...loan, supervisor: { username: 'admin', password: 'admin123' } });
  assert.equal((await call('products.list', 'A1'))[0].stock, 7);
  assert.equal((await call('loans.list', { pendingOnly: true }))[0].overdue, true);
  await call('loans.return', { id });
  assert.equal((await call('products.list', 'A1'))[0].stock, 10);
  assert.equal((await call('loans.list', { pendingOnly: true })).length, 0);
});

test('merma resta stock y genera alerta de stock bajo', async () => {
  const { call, pid } = await setup();
  await call('stock.move', { product_id: pid, qty: 8, type: 'waste', note: 'caducado' });
  assert.equal((await call('stock.low')).length, 1);
});
