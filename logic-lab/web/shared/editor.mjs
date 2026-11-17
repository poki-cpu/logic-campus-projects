import { TYPES, copy, evaluate, validate, connect, inputsOf, outputsOf } from './engine.mjs';
export const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export const bit = value => value === null || value === undefined ? '?' : value;
export function download(name, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function notify(message) {
  const target = document.getElementById('toast');
  target.textContent = message; target.classList.add('show');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => target.classList.remove('show'), 4200);
}
export function changeKind(before, after) {
  const topology = circuit => ({ ...circuit, nodes: circuit.nodes.map(({ x, y, value, ...n }) => n) });
  if (JSON.stringify(topology(before)) !== JSON.stringify(topology(after))) return 'topology';
  if (inputsOf(before).some((n, i) => n.value !== inputsOf(after)[i].value)) return 'input';
  return 'layout';
}
export function placement(nodes) {
  for (const y of [80,180,280,380,480,40]) for (const x of [300,440,580,720,160,20]) {
    if (nodes.every(n => Math.abs(n.x - x) >= 132 || Math.abs(n.y - y) >= 96)) return { x, y };
  }
  return null;
}
export function nextLabel(type, nodes) {
  const labels = new Set(nodes.map(n => n.label));
  const choices = type === 'INPUT' ? ['A','B','C','D'] : type === 'OUTPUT' ? ['Y','Z','S','C'] : [type];
  for (const label of choices) if (!labels.has(label)) return label;
  let suffix = 2;
  while (labels.has(type + suffix)) suffix++;
  return type + suffix;
}

const gateShapes = {
  AND: 'M20 8 H51 A24 24 0 0 1 51 56 H20 Z',
  OR: 'M20 8 Q55 8 78 32 Q55 56 20 56 Q38 32 20 8 Z',
  NOT: 'M25 9 L76 32 L25 55 Z',
};
function gateDrawing(type, inputValues = null, outputValue = null) {
  const inverted = ['NOT', 'NAND', 'NOR', 'XNOR'].includes(type);
  const exclusive = ['XOR', 'XNOR'].includes(type);
  const family = type === 'NOT' ? 'NOT' : ['AND', 'NAND'].includes(type) ? 'AND' : 'OR';
  const tip = family === 'AND' ? 75 : family === 'NOT' ? 76 : 78;
  // At y=19 and y=45, the OR rear curve intersects x=26.359375.
  const inlet = family === 'OR' ? 26.359375 : family === 'NOT' ? 25 : 20;
  const signal = value => inputValues ? `signal-${bit(value)}` : 'symbol-pin';
  return `<g class="gate-drawing" data-gate-type="${type}">${Array.from({ length: TYPES[type].inputs }, (_, i) => {
    const y = TYPES[type].inputs === 1 ? 32 : i === 0 ? 19 : 45;
    return `<path d="M0 ${y} H${inlet}" class="gate-pin ${signal(inputValues?.[i])}"/>`;
  }).join('')}<path d="M${tip + (inverted ? 10 : 0)} 32 H104" class="gate-pin ${signal(outputValue)}"/><path d="${gateShapes[family]}" class="gate-outline"/>${exclusive ? '<path d="M13 8 Q31 32 13 56" class="xor-curve"/>' : ''}${inverted ? `<circle cx="${tip + 5}" cy="32" r="5" class="inversion-bubble"/>` : ''}</g>`;
}
export function gateIcon(type) {
  const symbol = type === 'INPUT' ? '<path d="M75 32 H104" class="symbol-pin"/><rect x="10" y="15" width="65" height="34" rx="17" class="gate-outline"/><circle cx="29" cy="32" r="11" class="icon-switch"/>'
    : type === 'OUTPUT' ? '<path d="M0 32 H30" class="symbol-pin"/><circle cx="52" cy="32" r="23" class="gate-outline"/><path d="M39 19 L65 45 M65 19 L39 45" class="symbol-pin"/>'
    : gateDrawing(type);
  return `<svg class="gate-icon" viewBox="-3 0 110 64" aria-hidden="true" focusable="false">${symbol}</svg>`;
}

export class Editor {
  constructor(svg, circuit, options = {}) {
    this.svg = svg; this.options = options; this.circuit = copy(validate(circuit));
    this.selected = null; this.pending = null; this.history = []; this.future = [];
    svg.addEventListener('click', event => this.click(event));
    svg.addEventListener('pointerdown', event => this.pointerDown(event));
    svg.addEventListener('pointermove', event => this.pointerMove(event));
    svg.addEventListener('pointerup', event => this.pointerUp(event));
    svg.addEventListener('pointercancel', () => {
      if (this.drag) { this.circuit = this.drag.before; this.drag = null; this.render(); this.changed(false, 'selection'); }
    });
    svg.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); this.click(event); }
      if (event.key === 'Escape') { this.pending = null; this.render(); this.changed(false, 'selection'); }
      if (['Delete','Backspace'].includes(event.key)) { event.preventDefault(); this.remove(); }
      const n = this.circuit.nodes.find(n => n.id === this.selected);
      const moves = { ArrowLeft: [-10,0], ArrowRight: [10,0], ArrowUp: [0,-10], ArrowDown: [0,10] };
      if (n && moves[event.key]) {
        event.preventDefault(); const next = copy(this.circuit), target = next.nodes.find(v => v.id === n.id);
        target.x = Math.max(20, Math.min(750, target.x + moves[event.key][0]));
        target.y = Math.max(40, Math.min(480, target.y + moves[event.key][1])); this.commit(next, 'layout');
      }
    });
    this.render();
  }
  changed(edit = true, kind = edit ? 'topology' : 'selection') { this.options.onChange?.(this, edit, kind); }
  commit(next, kind = 'topology') {
    validate(next); this.history.push(copy(this.circuit)); if (this.history.length > 80) this.history.shift();
    this.future = []; this.circuit = next; this.render(); this.changed(kind === 'topology', kind);
  }
  load(circuit) {
    const next = copy(validate(circuit));
    this.pending = null; this.selected = null; this.commit(next);
  }
  undo() {
    if (!this.history.length) return;
    const before = this.circuit;
    this.future.push(copy(before)); this.circuit = this.history.pop(); this.pending = null; this.selected = null;
    const kind = changeKind(before, this.circuit); this.render(); this.changed(kind === 'topology', kind);
  }
  redo() {
    if (!this.future.length) return;
    const before = this.circuit;
    this.history.push(copy(before)); this.circuit = this.future.pop(); this.pending = null; this.selected = null;
    const kind = changeKind(before, this.circuit); this.render(); this.changed(kind === 'topology', kind);
  }
  add(type) {
    if (typeof type !== 'string' || !Object.hasOwn(TYPES, type)) return;
    if (this.options.allowed && !this.options.allowed.includes(type)) return notify('本关不能使用这个元件。');
    if (this.circuit.nodes.length >= 60) return notify('最多可放置 60 个元件。');
    if (type === 'INPUT' && inputsOf(this.circuit).length >= 4) return notify('最多支持 4 个输入。');
    if (type === 'OUTPUT' && outputsOf(this.circuit).length >= 4) return notify('最多支持 4 个输出。');
    const gates = this.circuit.nodes.filter(n => !['INPUT','OUTPUT'].includes(n.type));
    if (this.options.maxGates !== undefined && gates.length >= this.options.maxGates) return notify(`本关最多放置 ${this.options.maxGates} 个逻辑门。`);
    const position = placement(this.circuit.nodes);
    if (!position) return notify('画布空位不足，请先移动或删除不需要的元件。');
    const id = 'n' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const n = { id, type, label: nextLabel(type, this.circuit.nodes), ...position, ...(type === 'INPUT' ? { value: 0 } : {}) };
    this.selected = id; this.commit({ ...copy(this.circuit), nodes: [...copy(this.circuit.nodes), n] });
  }
  remove() {
    if (!this.selected) return notify('先选中要删除的元件。');
    if (this.options.fixed?.includes(this.selected)) return notify('本关的输入与输出不能删除。');
    const id = this.selected; this.selected = null; this.pending = null;
    this.commit({ ...copy(this.circuit), nodes: this.circuit.nodes.filter(n => n.id !== id), wires: this.circuit.wires.filter(w => w.from !== id && w.to !== id) });
  }
  setInputs(bits) {
    const next = copy(this.circuit); inputsOf(next).forEach((n, i) => n.value = bits[i]);
    validate(next); this.circuit = next; this.render(); this.changed(false, 'input');
  }
  select(id) { this.selected = id; this.render(); this.changed(false, 'selection'); }
  port(n, index, output = false) {
    return { x: n.x + (output ? 104 : 0), y: n.y + (output || TYPES[n.type].inputs === 1 ? 32 : index === 0 ? 19 : 45) };
  }
  focusKey() {
    const active = this.svg.ownerDocument.activeElement;
    if (!active || !this.svg.contains(active)) return null;
    for (const name of ['source','target','toggle','wire']) if (active.dataset?.[name] !== undefined) return `[data-${name}="${active.dataset[name]}"]${name === 'target' ? `[data-port="${active.dataset.port}"]` : ''}`;
    const node = active.closest('[data-node]');
    return node ? `[data-node="${node.dataset.node}"] .node-body` : 'svg';
  }
  render() {
    const focus = this.focusKey(), highlight = new Set(this.options.highlight || []);
    const { values, reasons } = evaluate(this.circuit);
    const nodes = new Map(this.circuit.nodes.map(n => [n.id, n]));
    const incoming = new Map(this.circuit.wires.map(w => [`${w.to}:${w.port}`, w.from]));
    this.svg.innerHTML = `<defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="grid-dot"/></pattern></defs><rect width="880" height="560" fill="url(#dots)"/>` +
    this.circuit.wires.map((w, i) => {
      const from = nodes.get(w.from), to = nodes.get(w.to);
      const a = this.port(from, 0, true), b = this.port(to, w.port), curve = Math.max(45, Math.abs(b.x - a.x) * 0.5);
      const d = `M${a.x},${a.y} C${Math.min(868, a.x + curve)},${a.y} ${Math.max(12, b.x - curve)},${b.y} ${b.x},${b.y}`;
      const value = bit(values.get(from.id));
      return `<g data-wire="${i}" data-signal="${value}" class="${highlight.has(w.from) && highlight.has(w.to) ? 'highlighted' : ''}" role="button" tabindex="0" aria-label="删除连线 ${esc(from.label)} 到 ${esc(to.label)} 端口 ${w.port + 1}，信号 ${value}"><title>${esc(from.label)} → ${esc(to.label)} 输入 ${w.port + 1} = ${value}；点击删除</title><path d="${d}" class="wire-backdrop"/><path d="${d}" class="wire-highlight"/><path d="${d}" class="wire-hit"/><path d="${d}" class="wire signal-${value}"/></g>`;
    }).join('') + this.circuit.nodes.map(n => {
      const value = values.get(n.id), selected = this.selected === n.id;
      const inputValues = Array.from({ length: TYPES[n.type].inputs }, (_, i) => values.get(incoming.get(`${n.id}:${i}`)) ?? null);
      const ports = inputValues.map((inputValue, i) => {
        const p = this.port(n, i), source = nodes.get(incoming.get(`${n.id}:${i}`));
        const description = source ? `${source.label} = ${bit(inputValue)}` : '未连接';
        return `<g class="port-control" data-port="${i}" data-target="${n.id}" data-signal="${bit(inputValue)}" role="button" tabindex="0" aria-label="连接到 ${esc(n.label)} 输入 ${i + 1}，${esc(description)}"><title>输入 ${i + 1}：${esc(description)}</title><rect x="${p.x - 20}" y="${p.y - 12}" width="40" height="24" class="port-hit"/><circle cx="${p.x}" cy="${p.y}" r="6" class="port input-port signal-${bit(inputValue)} ${this.pending ? 'ready' : ''}"/></g>`;
      }).join('');
      const out = this.port(n, 0, true), isGate = !['INPUT', 'OUTPUT'].includes(n.type);
      const label = [...n.label].length > 10 ? [...n.label].slice(0, 9).join('') + '…' : n.label;
      return `<g class="node ${isGate ? 'logic-gate' : 'terminal'} ${selected ? 'selected' : ''} ${highlight.has(n.id) ? 'highlighted' : ''} ${n.type.toLowerCase()} signal-${bit(value)}" data-node="${n.id}" data-signal="${bit(value)}" role="group" aria-label="${esc(n.label)} ${TYPES[n.type].label} 输出 ${bit(value)}"><title>${esc(n.label)} · ${TYPES[n.type].label} · ${bit(value)}${reasons.has(n.id) ? ' · ' + esc(reasons.get(n.id)) : ''}</title><rect x="${n.x}" y="${n.y}" width="104" height="64" rx="10" class="node-body" tabindex="0" role="button" aria-label="选择 ${esc(n.label)}"/><text x="${Math.max(64, n.x + 52)}" y="${n.y + 76}" class="node-label">${esc(label)}</text>${n.type === 'INPUT' ? `<path d="M${n.x + 88} ${n.y + 32} H${n.x + 104}" class="gate-pin signal-${bit(value)}"/><g data-toggle="${n.id}" role="button" tabindex="0" aria-pressed="${value === 1}" aria-label="切换输入 ${esc(n.label)}，当前 ${value}"><rect x="${n.x + 16}" y="${n.y + 15}" width="72" height="34" rx="17" class="switch-track"/><circle cx="${n.x + (value ? 71 : 33)}" cy="${n.y + 32}" r="12" class="switch-knob"/><text x="${n.x + (value ? 33 : 71)}" y="${n.y + 37}" class="switch-number">${value}</text></g>` : n.type === 'OUTPUT' ? `<path d="M${n.x} ${n.y + 32} H${n.x + 20}" class="gate-pin signal-${bit(value)}"/><circle cx="${n.x + 33}" cy="${n.y + 32}" r="13" class="bulb"/><path d="M${n.x + 25} ${n.y + 24} l16 16 m0 -16 l-16 16" class="bulb-filament"/><text x="${n.x + 73}" y="${n.y + 41}" class="gate-symbol">${bit(value)}</text>` : `<g transform="translate(${n.x} ${n.y})">${gateDrawing(n.type, inputValues, value)}<text x="${n.type === 'NOT' ? 43 : 48}" y="36" class="gate-type">${n.type}</text></g>`}${ports}${n.type !== 'OUTPUT' ? `<g class="port-control" data-source="${n.id}" data-signal="${bit(value)}" tabindex="0" role="button" aria-label="从 ${esc(n.label)} 输出开始连线，信号 ${bit(value)}"><title>输出 = ${bit(value)}；点击开始连线</title><rect x="${out.x - 14}" y="${out.y - 20}" width="38" height="40" rx="10" class="port-hit"/><circle cx="${out.x}" cy="${out.y}" r="6" class="port output-port signal-${bit(value)} ${this.pending === n.id ? 'pending' : ''}"/></g><text x="${n.x + 118}" y="${n.y + 23}" class="port-value signal-${bit(value)}">${bit(value)}</text>` : ''}</g>`;
    }).join('');
    if (focus) (this.svg.querySelector(focus) || this.svg).focus({ preventScroll: true });
  }
  click(event) {
    if (this.ignoreClick && event.type === 'click') { this.ignoreClick = false; return; }
    const source = event.target.closest('[data-source]');
    if (source) { this.pending = this.pending === source.dataset.source ? null : source.dataset.source; this.render(); this.changed(false, 'selection'); return; }
    const target = event.target.closest('[data-target]');
    if (target) {
      if (!this.pending) return notify('先点击上游元件右侧的输出圆点，再点这个输入端口。');
      try { const next = connect(this.circuit, this.pending, target.dataset.target, Number(target.dataset.port)); this.pending = null; this.commit(next); }
      catch (error) { notify(error.message); }
      return;
    }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const next = copy(this.circuit), n = next.nodes.find(n => n.id === toggle.dataset.toggle); n.value = 1 - n.value;
      this.selected = n.id; this.commit(next, 'input'); return;
    }
    const wire = event.target.closest('[data-wire]');
    if (wire) { const next = copy(this.circuit); next.wires.splice(Number(wire.dataset.wire), 1); this.commit(next); return; }
    const node = event.target.closest('[data-node]');
    this.selected = node?.dataset.node || null; this.pending = null; this.render(); this.changed(false, 'selection');
  }
  point(event) { return new DOMPoint(event.clientX, event.clientY).matrixTransform(this.svg.getScreenCTM().inverse()); }
  pointerDown(event) {
    this.ignoreClick = false;
    if (event.button !== 0 || event.target.closest('[data-source],[data-target],[data-toggle]')) return;
    const group = event.target.closest('[data-node]'); if (!group) return;
    const n = this.circuit.nodes.find(n => n.id === group.dataset.node);
    this.drag = { id: n.id, before: copy(this.circuit), origin: { x: n.x, y: n.y }, start: this.point(event), moved: false };
    this.svg.setPointerCapture(event.pointerId);
  }
  pointerMove(event) {
    if (!this.drag) return;
    const p = this.point(event), dx = p.x - this.drag.start.x, dy = p.y - this.drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !this.drag.moved) return;
    this.drag.moved = true; this.selected = this.drag.id;
    const n = this.circuit.nodes.find(n => n.id === this.drag.id);
    n.x = Math.max(20, Math.min(750, Math.round((this.drag.origin.x + dx) / 10) * 10));
    n.y = Math.max(40, Math.min(480, Math.round((this.drag.origin.y + dy) / 10) * 10)); this.render();
  }
  pointerUp(event) {
    if (!this.drag) return;
    if (this.drag.moved) { this.history.push(this.drag.before); if (this.history.length > 80) this.history.shift(); this.future = []; this.changed(false, 'layout'); }
    else { this.selected = this.drag.id; this.pending = null; this.render(); this.changed(false, 'selection'); }
    this.ignoreClick = true;
    this.drag = null; if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
  }
}
