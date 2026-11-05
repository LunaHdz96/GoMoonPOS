import { useEffect, useState } from 'react';
import { api, Customer, dateStr, money } from '../api';
import { askText } from '../dialog';

interface Statement { customer: Customer; text: string; whatsappUrl: string | null; entries: { id: number; created_at: string; amount: number; due_date: string | null; items: { name: string; qty: number; price: number }[] }[] }
const blank = { name: '', phone: '', credit_limit: 0, credit_days: 15 };

export default function Customers() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Partial<Customer>>(blank);
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<Customer[]>('customers.list', search).then(setRows);
  useEffect(() => { load(); }, [search]);

  const guard = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); load(); } catch (e) { setErr((e as Error).message); }
  };
  const openStatement = (id: number) => guard(async () => setStmt(await api<Statement>('credit.statement', id)));
  const abono = async (c: Customer) => {
    const amount = await askText(`Abono de ${c.name} (saldo ${money(c.balance)})`);
    if (!amount) return;
    const method = (await askText('Forma de pago: cash / card / transfer', { defaultValue: 'cash' })) || 'cash';
    guard(async () => { await api('credit.abono', { customer_id: c.id, amount: Number(amount), method }); if (stmt?.customer.id === c.id) setStmt(await api<Statement>('credit.statement', c.id)); });
  };

  return (
    <>
      <div className="card">
        <h3>{form.id ? 'Editar cliente' : 'Nuevo cliente'}</h3>
        <div className="row">
          <input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Teléfono (WhatsApp)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label>Límite de crédito <input type="number" min={0} value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })} /></label>
          <label>Días de crédito <input type="number" min={0} value={form.credit_days} onChange={(e) => setForm({ ...form, credit_days: Number(e.target.value) })} /></label>
          <button className="btn" onClick={() => guard(async () => { await api('customers.save', form); setForm(blank); })}>Guardar</button>
          {form.id && <button className="btn alt" onClick={() => setForm(blank)}>Cancelar</button>}
        </div>
        <small>El límite y los días de crédito sólo los modifican gerentes y administradores.</small>
        {err && <div className="err">{err}</div>}
      </div>
      <div className="card">
        <div className="row"><input placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <table>
          <thead><tr><th>Cliente</th><th>Teléfono</th><th>Límite</th><th>Saldo</th><th /></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td>{money(c.credit_limit)}</td>
              <td className={c.balance > 0 ? 'warn' : ''}>{money(c.balance)}</td>
              <td>
                <button className="btn" disabled={c.balance <= 0} onClick={() => abono(c)}>Abonar</button>{' '}
                <button className="btn alt" onClick={() => openStatement(c.id)}>Estado de cuenta</button>{' '}
                <button className="btn alt" onClick={() => setForm(c)}>Editar</button>
              </td></tr>
          ))}</tbody>
        </table>
      </div>
      {stmt && (
        <div className="card">
          <h3>Estado de cuenta — {stmt.customer.name}</h3>
          <table>
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Detalle</th><th>Monto</th><th>Vence</th></tr></thead>
            <tbody>{stmt.entries.map((e) => (
              <tr key={e.id}><td>{dateStr(e.created_at)}</td><td>{e.amount >= 0 ? 'Fiado' : 'Abono'}</td>
                <td>{e.items.map((i) => `${i.qty} x ${i.name}`).join(', ')}</td><td>{money(Math.abs(e.amount))}</td><td>{dateStr(e.due_date)}</td></tr>
            ))}</tbody>
          </table>
          <p className="total">Saldo: {money(stmt.customer.balance)}</p>
          <button className="btn" onClick={() => window.print()}>Imprimir</button>{' '}
          {stmt.whatsappUrl
            ? <button className="btn" onClick={() => window.open(stmt.whatsappUrl!)}>Enviar por WhatsApp</button>
            : <small>Agrega un teléfono para enviar por WhatsApp.</small>}{' '}
          <button className="btn alt" onClick={() => setStmt(null)}>Cerrar</button>
        </div>
      )}
    </>
  );
}
