const crypto = require('crypto');

const RANK = { cashier: 1, manager: 2, admin: 3 };
const MAX_CASHIER_DISCOUNT_PCT = 10;
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const now = () => new Date().toISOString();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex') };
}
function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function createService(db) {
  let session = null;

  if (!db.get('SELECT id FROM users LIMIT 1')) {
    const { salt, hash } = hashPassword('admin123');
    db.run('INSERT INTO users(username,name,role,salt,hash) VALUES(?,?,?,?,?)', ['admin', 'Administrador', 'admin', salt, hash]);
  }

  const need = (role) => {
    if (!session) throw new Error('Inicia sesión');
    if (RANK[session.role] < RANK[role]) throw new Error('No tienes permiso para esta acción');
  };

  // Returns the user authorizing a restricted action: the current user if
  // already a supervisor, otherwise valid supervisor credentials are required.
  function authorize(supervisor) {
    need('cashier');
    if (RANK[session.role] >= RANK.manager) return session;
    if (supervisor && supervisor.username) {
      const u = db.get('SELECT * FROM users WHERE username=? AND active=1', [supervisor.username]);
      if (u && RANK[u.role] >= RANK.manager && checkPassword(u, supervisor.password || '')) return u;
    }
    throw new Error('Se requiere autorización de un supervisor');
  }

  const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });

  function moveStock(productId, qty, type, note, userId) {
    db.run('UPDATE products SET stock = stock + ? WHERE id=?', [qty, productId]);
    db.run('INSERT INTO stock_movements(product_id,qty,type,note,user_id,created_at) VALUES(?,?,?,?,?,?)', [productId, qty, type, note || '', userId, now()]);
  }

  function ledger(customerId) {
    return db.all('SELECT * FROM credit_entries WHERE customer_id=? ORDER BY created_at, id', [customerId]);
  }

  // Applies payments FIFO to charges; returns charges still pending.
  function pendingCharges(customerId) {
    let paid = 0;
    const charges = [];
    for (const e of ledger(customerId)) {
      if (e.amount < 0) paid += -e.amount;
      else charges.push({ ...e, remaining: e.amount });
    }
    for (const c of charges) {
      const used = Math.min(c.remaining, paid);
      c.remaining = r2(c.remaining - used);
      paid -= used;
    }
    return charges.filter((c) => c.remaining > 0.004);
  }

  function overdueInfo(customer) {
    const t = now();
    const late = pendingCharges(customer.id).filter((c) => c.due_date && c.due_date < t);
    const overLimit = customer.credit_limit > 0 && customer.balance > customer.credit_limit + 0.004;
    if (!late.length && !overLimit) return null;
    const oldest = late[0];
    return {
      customer_id: customer.id, name: customer.name, phone: customer.phone,
      balance: customer.balance, credit_limit: customer.credit_limit,
      overdue_amount: r2(late.reduce((s, c) => s + c.remaining, 0)),
      oldest_due: oldest ? oldest.due_date : null,
      days_late: oldest ? Math.floor((Date.parse(t) - Date.parse(oldest.due_date)) / 86400000) : 0,
      over_limit: overLimit,
    };
  }

  const range = (from, to) => [from || '0000', to || '9999'];

  const handlers = {
    // ---- sesión y usuarios
    login(username, password) {
      const u = db.get('SELECT * FROM users WHERE username=? AND active=1', [username]);
      if (!u || !checkPassword(u, password || '')) throw new Error('Usuario o contraseña incorrectos');
      session = publicUser(u);
      return session;
    },
    logout() { session = null; return true; },
    me() { return session; },
    'users.list'() {
      need('admin');
      return db.all('SELECT id,username,name,role,active FROM users ORDER BY name');
    },
    'users.save'(u) {
      need('admin');
      if (!RANK[u.role]) throw new Error('Rol inválido');
      if (!u.username || !u.name) throw new Error('Usuario y nombre son obligatorios');
      if (u.id) {
        if (u.id === session.id && (u.role !== 'admin' || !u.active)) throw new Error('No puedes quitarte tu propio acceso de administrador');
        db.run('UPDATE users SET username=?,name=?,role=?,active=? WHERE id=?', [u.username, u.name, u.role, u.active ? 1 : 0, u.id]);
        if (u.password) {
          const { salt, hash } = hashPassword(u.password);
          db.run('UPDATE users SET salt=?,hash=? WHERE id=?', [salt, hash, u.id]);
        }
        return u.id;
      }
      if (!u.password) throw new Error('La contraseña es obligatoria');
      const { salt, hash } = hashPassword(u.password);
      return db.run('INSERT INTO users(username,name,role,salt,hash,active) VALUES(?,?,?,?,?,?)', [u.username, u.name, u.role, salt, hash, u.active === false ? 0 : 1]);
    },

    // ---- inventario
    'products.list'(search) {
      need('cashier');
      const q = `%${search || ''}%`;
      return db.all('SELECT * FROM products WHERE active=1 AND (name LIKE ? OR sku LIKE ?) ORDER BY name', [q, q]);
    },
    'products.save'(p) {
      need('manager');
      if (!p.sku || !p.name || !(p.price >= 0)) throw new Error('SKU, nombre y precio son obligatorios');
      if (p.id) {
        db.run('UPDATE products SET sku=?,name=?,price=?,cost=?,min_stock=? WHERE id=?', [p.sku, p.name, p.price, p.cost || 0, p.min_stock || 0, p.id]);
        return p.id;
      }
      return db.tx(() => {
        const id = db.run('INSERT INTO products(sku,name,price,cost,min_stock) VALUES(?,?,?,?,?)', [p.sku, p.name, p.price, p.cost || 0, p.min_stock || 0]);
        if (p.stock > 0) moveStock(id, p.stock, 'purchase', 'Existencia inicial', session.id);
        return id;
      });
    },
    'products.remove'(id) {
      need('manager');
      db.run('UPDATE products SET active=0 WHERE id=?', [id]);
      return true;
    },
    // type: purchase (entrada), adjust (+/-), waste (merma, siempre resta)
    'stock.move'({ product_id, qty, type, note }) {
      need('manager');
      if (!['purchase', 'adjust', 'waste'].includes(type)) throw new Error('Tipo inválido');
      let delta = Number(qty);
      if (!delta || !isFinite(delta)) throw new Error('Cantidad inválida');
      if (type === 'waste') delta = -Math.abs(delta);
      if (type === 'purchase') delta = Math.abs(delta);
      const p = db.get('SELECT * FROM products WHERE id=?', [product_id]);
      if (!p) throw new Error('Producto no encontrado');
      if (p.stock + delta < 0) throw new Error('El stock no puede quedar negativo');
      moveStock(product_id, delta, type, note, session.id);
      return true;
    },
    'stock.low'() {
      need('cashier');
      return db.all('SELECT * FROM products WHERE active=1 AND stock <= min_stock ORDER BY stock');
    },
    'stock.movements'(productId) {
      need('manager');
      return db.all('SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id=m.user_id WHERE product_id=? ORDER BY m.id DESC LIMIT 200', [productId]);
    },

    // ---- clientes y fiados
    'customers.list'(search) {
      need('cashier');
      const q = `%${search || ''}%`;
      return db.all('SELECT * FROM customers WHERE active=1 AND (name LIKE ? OR phone LIKE ?) ORDER BY name', [q, q]);
    },
    'customers.save'(c) {
      need('cashier');
      if (!c.name) throw new Error('El nombre es obligatorio');
      const limit = Number(c.credit_limit) || 0;
      const days = Number.isInteger(c.credit_days) && c.credit_days >= 0 ? c.credit_days : 15;
      if (c.id) {
        const old = db.get('SELECT * FROM customers WHERE id=?', [c.id]);
        if (!old) throw new Error('Cliente no encontrado');
        // Sólo supervisores pueden cambiar condiciones de crédito.
        const canCredit = RANK[session.role] >= RANK.manager;
        db.run('UPDATE customers SET name=?,phone=?,credit_limit=?,credit_days=? WHERE id=?', [c.name, c.phone || '', canCredit ? limit : old.credit_limit, canCredit ? days : old.credit_days, c.id]);
        return c.id;
      }
      const canCredit = RANK[session.role] >= RANK.manager;
      return db.run('INSERT INTO customers(name,phone,credit_limit,credit_days) VALUES(?,?,?,?)', [c.name, c.phone || '', canCredit ? limit : 0, canCredit ? days : 15]);
    },
    'credit.abono'({ customer_id, amount, method }) {
      need('cashier');
      amount = r2(Number(amount));
      if (!(amount > 0)) throw new Error('Monto inválido');
      if (!['cash', 'card', 'transfer'].includes(method)) throw new Error('Forma de pago inválida');
      const c = db.get('SELECT * FROM customers WHERE id=?', [customer_id]);
      if (!c) throw new Error('Cliente no encontrado');
      if (amount > c.balance + 0.004) throw new Error('El abono excede el saldo del cliente');
      return db.tx(() => {
        const t = now();
        db.run('INSERT INTO credit_entries(customer_id,amount,note,created_at) VALUES(?,?,?,?)', [customer_id, -amount, 'Abono', t]);
        db.run('INSERT INTO payments(customer_id,method,kind,amount,user_id,created_at) VALUES(?,?,?,?,?,?)', [customer_id, method, 'abono', amount, session.id, t]);
        db.run('UPDATE customers SET balance = ROUND(balance - ?,2) WHERE id=?', [amount, customer_id]);
        return db.get('SELECT balance FROM customers WHERE id=?', [customer_id]).balance;
      });
    },
    'credit.statement'(customerId) {
      need('cashier');
      const c = db.get('SELECT * FROM customers WHERE id=?', [customerId]);
      if (!c) throw new Error('Cliente no encontrado');
      const entries = ledger(customerId).map((e) => {
        const items = e.sale_id ? db.all('SELECT name,qty,price FROM sale_items WHERE sale_id=?', [e.sale_id]) : [];
        return { ...e, items };
      });
      const pending = pendingCharges(customerId);
      const fmt = (n) => `$${n.toFixed(2)}`;
      const d = (s) => new Date(s).toLocaleDateString('es-MX');
      const lines = ['*GoMoonPOS - Estado de cuenta*', `Cliente: ${c.name}`, `Fecha: ${d(now())}`, ''];
      for (const e of entries) {
        lines.push(`${d(e.created_at)}  ${e.amount >= 0 ? 'Fiado' : 'Abono'}  ${fmt(Math.abs(e.amount))}`);
        for (const i of e.items) lines.push(`   - ${i.qty} x ${i.name} (${fmt(i.price)})`);
      }
      lines.push('', `*Saldo actual: ${fmt(c.balance)}*`);
      if (pending[0] && pending[0].due_date) lines.push(`Próximo vencimiento: ${d(pending[0].due_date)}`);
      const text = lines.join('\n');
      const phone = (c.phone || '').replace(/\D/g, '');
      return {
        customer: c, entries, text,
        whatsappUrl: phone ? `https://wa.me/${phone.length === 10 ? '52' + phone : phone}?text=${encodeURIComponent(text)}` : null,
      };
    },
    'credit.overdue'() {
      need('manager');
      return db.all('SELECT * FROM customers WHERE active=1 AND balance > 0').map(overdueInfo).filter(Boolean).sort((a, b) => b.days_late - a.days_late);
    },

    // ---- ventas
    'sales.create'({ items, discount, payments, customer_id, supervisor }) {
      need('cashier');
      if (!Array.isArray(items) || !items.length) throw new Error('La venta no tiene productos');
      const lines = items.map((i) => {
        const p = db.get('SELECT * FROM products WHERE id=? AND active=1', [i.product_id]);
        const qty = Number(i.qty);
        if (!p) throw new Error('Producto no encontrado');
        if (!(qty > 0)) throw new Error('Cantidad inválida');
        return { p, qty };
      });
      const needed = new Map();
      for (const l of lines) needed.set(l.p.id, (needed.get(l.p.id) || 0) + l.qty);
      for (const [id, qty] of needed) {
        const p = db.get('SELECT * FROM products WHERE id=?', [id]);
        if (p.stock < qty) throw new Error(`Stock insuficiente de ${p.name} (disponible: ${p.stock})`);
      }
      const subtotal = r2(lines.reduce((s, l) => s + l.p.price * l.qty, 0));
      let disc = 0;
      if (discount && discount.value > 0) {
        const pct = discount.type === 'percent' ? discount.value : (discount.value / subtotal) * 100;
        if (pct > 100) throw new Error('Descuento inválido');
        if (pct > MAX_CASHIER_DISCOUNT_PCT && RANK[session.role] < RANK.manager) authorize(supervisor);
        disc = r2(discount.type === 'percent' ? (subtotal * discount.value) / 100 : discount.value);
      }
      const total = r2(subtotal - disc);
      const pays = (payments || []).map((p) => ({ method: p.method, amount: r2(Number(p.amount)) })).filter((p) => p.amount > 0);
      if (pays.some((p) => !['cash', 'card', 'transfer', 'credit'].includes(p.method))) throw new Error('Forma de pago inválida');
      if (Math.abs(pays.reduce((s, p) => s + p.amount, 0) - total) > 0.004) throw new Error('Los pagos no cubren el total');
      const creditAmt = r2(pays.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0));
      let customer = null;
      let authUser = session;
      if (customer_id) customer = db.get('SELECT * FROM customers WHERE id=? AND active=1', [customer_id]);
      if (creditAmt > 0) {
        authUser = authorize(supervisor);
        if (!customer) throw new Error('Selecciona un cliente para fiar');
        if (customer.credit_limit <= 0) throw new Error('El cliente no tiene crédito asignado');
        if (customer.balance + creditAmt > customer.credit_limit + 0.004) throw new Error('Se excede el límite de crédito del cliente');
      }
      return db.tx(() => {
        const t = now();
        const saleId = db.run('INSERT INTO sales(user_id,customer_id,subtotal,discount,total,created_at) VALUES(?,?,?,?,?,?)', [session.id, customer ? customer.id : null, subtotal, disc, total, t]);
        for (const l of lines) {
          db.run('INSERT INTO sale_items(sale_id,product_id,name,qty,price) VALUES(?,?,?,?,?)', [saleId, l.p.id, l.p.name, l.qty, l.p.price]);
          moveStock(l.p.id, -l.qty, 'sale', `Venta #${saleId}`, session.id);
        }
        for (const p of pays) db.run('INSERT INTO payments(sale_id,customer_id,method,kind,amount,user_id,created_at) VALUES(?,?,?,?,?,?,?)', [saleId, customer ? customer.id : null, p.method, 'sale', p.amount, session.id, t]);
        if (creditAmt > 0) {
          const due = new Date(Date.now() + customer.credit_days * 86400000).toISOString();
          db.run('INSERT INTO credit_entries(customer_id,sale_id,amount,note,due_date,created_at) VALUES(?,?,?,?,?,?)', [customer.id, saleId, creditAmt, `Autorizó: ${authUser.name || authUser.username}`, due, t]);
          db.run('UPDATE customers SET balance = ROUND(balance + ?,2) WHERE id=?', [creditAmt, customer.id]);
        }
        return { id: saleId, total, subtotal, discount: disc, created_at: t };
      });
    },
    'sales.cancel'(saleId) {
      need('manager');
      const s = db.get('SELECT * FROM sales WHERE id=?', [saleId]);
      if (!s || s.status !== 'done') throw new Error('Venta no encontrada o ya cancelada');
      return db.tx(() => {
        for (const i of db.all('SELECT * FROM sale_items WHERE sale_id=?', [saleId])) moveStock(i.product_id, i.qty, 'cancel', `Cancelación venta #${saleId}`, session.id);
        const credit = db.get("SELECT COALESCE(SUM(amount),0) AS a FROM payments WHERE sale_id=? AND method='credit'", [saleId]).a;
        if (credit > 0) {
          db.run('INSERT INTO credit_entries(customer_id,sale_id,amount,note,created_at) VALUES(?,?,?,?,?)', [s.customer_id, saleId, -credit, `Cancelación venta #${saleId}`, now()]);
          db.run('UPDATE customers SET balance = ROUND(balance - ?,2) WHERE id=?', [credit, s.customer_id]);
        }
        db.run("UPDATE sales SET status='cancelled' WHERE id=?", [saleId]);
        return true;
      });
    },
    'sales.list'({ from, to } = {}) {
      need('manager');
      const [f, t] = range(from, to);
      return db.all('SELECT s.*, u.name AS user_name, c.name AS customer_name FROM sales s JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.created_at>=? AND s.created_at<=? ORDER BY s.id DESC LIMIT 500', [f, t]);
    },

    // ---- préstamos (no afectan el corte de caja)
    'loans.create'({ product_id, customer_id, qty, due_date, note, supervisor }) {
      const auth = authorize(supervisor);
      qty = Number(qty);
      if (!(qty > 0)) throw new Error('Cantidad inválida');
      const p = db.get('SELECT * FROM products WHERE id=? AND active=1', [product_id]);
      const c = db.get('SELECT * FROM customers WHERE id=? AND active=1', [customer_id]);
      if (!p || !c) throw new Error('Producto o cliente no encontrado');
      if (p.stock < qty) throw new Error('Stock insuficiente');
      return db.tx(() => {
        const id = db.run('INSERT INTO loans(product_id,customer_id,qty,due_date,note,user_id,created_at) VALUES(?,?,?,?,?,?,?)', [product_id, customer_id, qty, due_date || null, note || '', auth.id, now()]);
        moveStock(product_id, -qty, 'loan', `Préstamo #${id} a ${c.name}`, session.id);
        return id;
      });
    },
    'loans.return'({ id, qty }) {
      need('cashier');
      const l = db.get('SELECT * FROM loans WHERE id=?', [id]);
      if (!l) throw new Error('Préstamo no encontrado');
      const pending = l.qty - l.returned_qty;
      qty = qty === undefined ? pending : Number(qty);
      if (!(qty > 0) || qty > pending + 1e-9) throw new Error('Cantidad inválida');
      return db.tx(() => {
        const done = Math.abs(pending - qty) < 1e-9;
        db.run('UPDATE loans SET returned_qty = returned_qty + ?, returned_at = ? WHERE id=?', [qty, done ? now() : null, id]);
        moveStock(l.product_id, qty, 'return', `Devolución préstamo #${id}`, session.id);
        return true;
      });
    },
    'loans.list'({ pendingOnly } = {}) {
      need('cashier');
      const rows = db.all(`SELECT l.*, p.name AS product_name, c.name AS customer_name, c.phone AS customer_phone
        FROM loans l JOIN products p ON p.id=l.product_id JOIN customers c ON c.id=l.customer_id
        ${pendingOnly ? 'WHERE l.returned_qty < l.qty' : ''} ORDER BY l.id DESC`);
      const t = now();
      return rows.map((l) => ({ ...l, pending_qty: l.qty - l.returned_qty, overdue: l.returned_qty < l.qty && !!l.due_date && l.due_date < t }));
    },

    // ---- reportes
    'reports.byProduct'({ from, to } = {}) {
      need('manager');
      const [f, t] = range(from, to);
      return db.all(`SELECT i.product_id, i.name, SUM(i.qty) AS qty, ROUND(SUM(i.qty*i.price),2) AS revenue
        FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.status='done' AND s.created_at>=? AND s.created_at<=?
        GROUP BY i.product_id, i.name ORDER BY revenue DESC`, [f, t]);
    },
    'reports.byHour'({ from, to } = {}) {
      need('manager');
      const [f, t] = range(from, to);
      const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, sales: 0, total: 0 }));
      for (const s of db.all("SELECT total, created_at FROM sales WHERE status='done' AND created_at>=? AND created_at<=?", [f, t])) {
        const h = hours[new Date(s.created_at).getHours()];
        h.sales++;
        h.total = r2(h.total + s.total);
      }
      return hours;
    },
    'reports.byEmployee'({ from, to } = {}) {
      need('manager');
      const [f, t] = range(from, to);
      return db.all(`SELECT u.id, u.name, COUNT(s.id) AS sales, ROUND(COALESCE(SUM(s.total),0),2) AS total,
        ROUND(COALESCE(AVG(s.total),0),2) AS avg_ticket FROM users u
        LEFT JOIN sales s ON s.user_id=u.id AND s.status='done' AND s.created_at>=? AND s.created_at<=?
        GROUP BY u.id, u.name ORDER BY total DESC`, [f, t]);
    },
    // Corte de caja: sólo dinero realmente recibido (sin fiado ni préstamos); abonos incluidos.
    'reports.cashClose'({ from, to } = {}) {
      need('manager');
      const [f, t] = range(from, to);
      const byMethod = db.all(`SELECT p.method, p.kind, ROUND(SUM(p.amount),2) AS amount FROM payments p
        LEFT JOIN sales s ON s.id=p.sale_id
        WHERE p.method <> 'credit' AND (s.status IS NULL OR s.status='done') AND p.created_at>=? AND p.created_at<=?
        GROUP BY p.method, p.kind`, [f, t]);
      const creditSales = db.get(`SELECT ROUND(COALESCE(SUM(p.amount),0),2) AS a FROM payments p JOIN sales s ON s.id=p.sale_id
        WHERE p.method='credit' AND s.status='done' AND p.created_at>=? AND p.created_at<=?`, [f, t]).a;
      return { byMethod, total: r2(byMethod.reduce((s, r) => s + r.amount, 0)), creditSales };
    },
  };

  return {
    async call(method, args) {
      const fn = handlers[method];
      if (!fn) throw new Error(`Método desconocido: ${method}`);
      return fn(...(args || []));
    },
  };
}

module.exports = { createService };
