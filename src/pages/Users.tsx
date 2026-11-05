import { useEffect, useState } from 'react';
import { api, Role, User } from '../api';

const blank = { username: '', name: '', role: 'cashier' as Role, password: '', active: 1 };

export default function Users() {
  const [rows, setRows] = useState<User[]>([]);
  const [form, setForm] = useState<Partial<User> & { password?: string }>(blank);
  const [err, setErr] = useState('');
  const load = () => api<User[]>('users.list').then(setRows);
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr('');
    try { await api('users.save', form); setForm(blank); load(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="card">
        <h3>{form.id ? 'Editar usuario' : 'Nuevo usuario'}</h3>
        <div className="row">
          <input placeholder="Usuario" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="cashier">Cajero</option><option value="manager">Gerente</option><option value="admin">Administrador</option>
          </select>
          <input type="password" placeholder={form.id ? 'Nueva contraseña (opcional)' : 'Contraseña'} value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <label><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })} /> Activo</label>
          <button className="btn" onClick={save}>Guardar</button>
          {form.id && <button className="btn alt" onClick={() => setForm(blank)}>Cancelar</button>}
        </div>
        {err && <div className="err">{err}</div>}
        <small>Usuario inicial: admin / admin123 — cámbiala al primer ingreso.</small>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Activo</th><th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id}><td>{u.username}</td><td>{u.name}</td><td>{u.role}</td><td>{u.active ? 'Sí' : 'No'}</td>
              <td><button className="btn alt" onClick={() => setForm({ ...u, password: '' })}>Editar</button></td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
