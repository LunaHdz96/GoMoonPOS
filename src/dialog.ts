// window.prompt is not available in Electron, so use a small DOM-based dialog.
export function askText(label: string, opts: { secret?: boolean; defaultValue?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:#0006;display:flex;align-items:center;justify-content:center;z-index:99';
    const box = document.createElement('form');
    box.className = 'card';
    box.style.cssText = 'min-width:300px;margin:0';
    const text = document.createElement('div');
    text.textContent = label;
    text.style.marginBottom = '8px';
    const input = document.createElement('input');
    input.type = opts.secret ? 'password' : 'text';
    input.value = opts.defaultValue ?? '';
    input.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:8px';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'btn';
    ok.textContent = 'Aceptar';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn alt';
    cancel.textContent = 'Cancelar';
    cancel.style.marginLeft = '8px';
    const done = (v: string | null) => { overlay.remove(); resolve(v); };
    box.onsubmit = (e) => { e.preventDefault(); done(input.value); };
    cancel.onclick = () => done(null);
    box.append(text, input, ok, cancel);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
  });
}
