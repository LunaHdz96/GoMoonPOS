import { useEffect, useState } from 'react';
import { api, Customer, money, Product, withSupervisor } from '../api';

interface Line { product: Product; qty: number }

export default function Sales() {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [discType, setDiscType] = useState<'percent' | 'amount'>('percent');
  const [discValue, setDiscValue] = useState(0);
  const [customerId, setCustomerId] = useState(0);
  const [card, setCard] = useState(0);
  const [transfer, setTransfer] = useState(0);
  const [credit, setCredit] = useState(0);
  const [tendered, setTendered] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<Product[]>('products.list', search).then(setProducts);
  useEffect(() => { load(); }, [search]);
  useEffect(() => { api<Customer[]>('customers.list', '').then(setCustomers); }, []);

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const disc = discValue > 0 ? (discType === 'percent' ? (subtotal * discValue) / 100 : discValue) : 0;
  const total = Math.max(0, Math.round((subtotal - disc) * 100) / 100);
  const cash = Math.round((total - card - transfer - credit) * 100) / 100;
  const change = tendered > 0 ? Math.max(0, tendered - cash) : 0;

  const add = (p: Product) => setCart((c) => {
    const i = c.findIndex((l) => l.product.id === p.id);
    if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
    return [...c, { product: p, qty: 1 }];
  });
  const setQty = (id: number, qty: number) => setCart((c) => c.map((l) => (l.product.id === id ? { ...l, qty } : l)).filter((l) => l.qty > 0));

  const charge = async () => {
    setMsg(null);
    const payments = [
      { method: 'cash', amount: cash }, { method: 'card', amount: card },
      { method: 'transfer', amount: transfer }, { method: 'credit', amount: credit },
    ].filter((p) => p.amount > 0);
    try {
      const sale = await withSupervisor((supervisor) => api('sales.create', {
        items: cart.map((l) => ({ product_id: l.product.id, qty: l.qty })),
        discount: discValue > 0 ? { type: discType, value: discValue } : undefined,
        payments, customer_id: customerId || undefined, supervisor,
      }));
      setMsg({ ok: true, text: `Venta #${sale.id} registrada. Total ${money(sale.total)}${change > 0 ? ` — Cambio ${money(change)}` : ''}` });
      setCart([]); setDiscValue(0); setCard(0); setTransfer(0); setCredit(0); setTendered(0);
      load(); api<Customer[]>('customers.list', '').then(setCustomers);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div className="grid2">
      <div className="card">
        <div className="row"><input style={{ flex: 1 }} placeholder="Buscar por nombre o SKU" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && products.length) { add(products.find((p) => p.sku === search) ?? products[0]); setSearch(''); } }} /></div>
        <table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Precio</th><th>Stock</th><th /></tr></thead>
          <tbody>{products.map((p) => (
            <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{money(p.price)}</td>
              <td className={p.stock <= p.min_stock ? 'warn' : ''}>{p.stock}</td>
              <td><button className="btn" disabled={p.stock <= 0} onClick={() => add(p)}>+</button></td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <h3>Venta actual</h3>
        <table>
          <tbody>{cart.map((l) => (
            <tr key={l.product.id}><td>{l.product.name}</td>
              <td><input type="number" min={0} style={{ width: 70 }} value={l.qty} onChange={(e) => setQty(l.product.id, Number(e.target.value))} /></td>
              <td>{money(l.product.price * l.qty)}</td></tr>
          ))}</tbody>
        </table>
        <div className="row">Descuento:
          <select value={discType} onChange={(e) => setDiscType(e.target.value as 'percent' | 'amount')}><option value="percent">%</option><option value="amount">$</option></select>
          <input type="number" min={0} style={{ width: 90 }} value={discValue} onChange={(e) => setDiscValue(Number(e.target.value))} />
        </div>
        <div className="row">Cliente:
          <select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
            <option value={0}>— Mostrador —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="row">Tarjeta <input type="number" min={0} style={{ width: 80 }} value={card} onChange={(e) => setCard(Number(e.target.value))} />
          Transferencia <input type="number" min={0} style={{ width: 80 }} value={transfer} onChange={(e) => setTransfer(Number(e.target.value))} />
          Fiado <input type="number" min={0} style={{ width: 80 }} value={credit} onChange={(e) => setCredit(Number(e.target.value))} /></div>
        <div className="row">Efectivo: <b>{money(Math.max(cash, 0))}</b> Recibido <input type="number" min={0} style={{ width: 80 }} value={tendered} onChange={(e) => setTendered(Number(e.target.value))} /> Cambio: <b>{money(change)}</b></div>
        <div className="total">Total {money(total)}</div>
        {msg && <div className={msg.ok ? 'ok' : 'err'}>{msg.text}</div>}
        <button className="btn" disabled={!cart.length || cash < 0} onClick={charge}>Cobrar</button>{' '}
        <button className="btn alt" onClick={() => setCart([])}>Limpiar</button>
      </div>
    </div>
  );
}
