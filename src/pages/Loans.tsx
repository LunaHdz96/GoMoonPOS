import { useEffect, useState } from 'react';
import { api, Customer, dateStr, Product, withSupervisor } from '../api';
import { askText } from '../dialog';

interface Loan { id: number; product_name: string; customer_name: string; customer_phone: string; qty: number; pending_qty: number; due_date: string | null; created_at: string; note: string; overdue: boolean }

export default function Loans() {
  const [rows, setRows] = useState<Loan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState({ product_id: 0, customer_id: 0, qty: 1, due_date: '', note: '' });
  const [pendingOnly, setPendingOnly] = useState(true);
  const [err, setErr] = useState('');
  const load = () => api<Loan[]>('loans.list', { pendingOnly }).then(setRows);
  useEffect(() => { load(); }, [pendingOnly]);
  useEffect(() => {
    api<Product[]>('products.list', '').then(setProducts);
    api<Customer[]>('customers.list', '').then(setCustomers);
  }, []);

  const lend = async () => {
    setErr('');
    try {
      await withSupervisor((supervisor) => api('loans.create', {
        ...form, supervisor,
        due_date: form.due_date ? new Date(form.due_date + 'T23:59:59').toISOString() : undefined,
      }));
      load(); api<Product[]>('products.list', '').then(setProducts);
    } catch (e) { setErr((e as Error).message); }
  };
  const giveBack = async (l: Loan) => {
    const qty = await askText('Cantidad devuelta', { defaultValue: String(l.pending_qty) });
    if (!qty) return;
    try { await api('loans.return', { id: l.id, qty: Number(qty) }); load(); api<Product[]>('products.list', '').then(setProducts); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="card">
        <h3>Nuevo préstamo (no afecta el corte de caja)</h3>
        <div className="row">
          <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: Number(e.target.value) })}>
            <option value={0}>— Artículo —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} (stock {p.stock})</option>)}
          </select>
          <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: Number(e.target.value) })}>
            <option value={0}>— Cliente / proveedor —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="number" min={1} style={{ width: 70 }} value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} />
          <label>Devolver antes de <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
          <input placeholder="Nota" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="btn" onClick={lend}>Prestar</button>
        </div>
        <small>Sólo supervisores pueden autorizar préstamos.</small>
        {err && <div className="err">{err}</div>}
      </div>
      <div className="card">
        <label><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> Sólo pendientes</label>
        <table>
          <thead><tr><th>Artículo</th><th>Persona</th><th>Prestado</th><th>Pendiente</th><th>Fecha</th><th>Vence</th><th /></tr></thead>
          <tbody>{rows.map((l) => (
            <tr key={l.id}><td>{l.product_name}</td><td>{l.customer_name}</td><td>{l.qty}</td>
              <td className={l.overdue ? 'bad' : l.pending_qty > 0 ? 'warn' : ''}>{l.pending_qty}{l.overdue ? ' ⚠ vencido' : ''}</td>
              <td>{dateStr(l.created_at)}</td><td>{dateStr(l.due_date)}</td>
              <td>{l.pending_qty > 0 && <button className="btn" onClick={() => giveBack(l)}>Registrar devolución</button>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
