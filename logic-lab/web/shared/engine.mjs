export const TYPES = Object.freeze({
  INPUT: { inputs: 0, label: '输入' },
  OUTPUT: { inputs: 1, label: '输出' },
  AND: { inputs: 2, label: '与门' },
  OR: { inputs: 2, label: '或门' },
  NOT: { inputs: 1, label: '非门' },
  XOR: { inputs: 2, label: '异或门' },
  NAND: { inputs: 2, label: '与非门' },
  NOR: { inputs: 2, label: '或非门' },
  XNOR: { inputs: 2, label: '同或门' },
});

export const copy = value => structuredClone(value);
export const inputsOf = circuit => circuit.nodes.filter(n => n.type === 'INPUT');
export const outputsOf = circuit => circuit.nodes.filter(n => n.type === 'OUTPUT');

export function validate(circuit) {
  if (!circuit || !Array.isArray(circuit.nodes) || !Array.isArray(circuit.wires)) throw new Error('文件中缺少 nodes 或 wires。');
  if (circuit.nodes.length > 60 || circuit.wires.length > 160) throw new Error('电路最多支持 60 个元件、160 条连线。');
  const ids = new Set(), inputNames = new Set();
  for (const n of circuit.nodes) {
    if (!n || typeof n.id !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(n.id) || ids.has(n.id)) throw new Error('元件编号无效或重复。');
    ids.add(n.id);
    if (typeof n.type !== 'string' || !Object.hasOwn(TYPES, n.type)) throw new Error('电路包含暂不支持的元件。');
    if (typeof n.label !== 'string' || !n.label.trim() || n.label.length > 30) throw new Error('元件名称应为 1–30 字的非空文本。');
    if (n.type === 'INPUT') {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(n.label)) throw new Error('输入变量须以英文字母开头，仅包含字母、数字或下划线。');
      if (inputNames.has(n.label)) throw new Error('输入变量名称不能重复。');
      inputNames.add(n.label);
    }
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || n.x < 0 || n.x > 750 || n.y < 0 || n.y > 480) throw new Error('元件位置超出画布范围（x: 0–750，y: 0–480）。');
    if (n.type === 'INPUT' && ![0, 1].includes(n.value)) throw new Error('输入值只能是 0 或 1。');
  }
  if (inputsOf(circuit).length > 4) throw new Error('当前版本最多支持 4 个独立输入。');
  if (outputsOf(circuit).length > 4) throw new Error('当前版本最多支持 4 个输出。');
  const occupied = new Set();
  for (const w of circuit.wires) {
    if (!w || typeof w.from !== 'string' || typeof w.to !== 'string') throw new Error('连线端口无效。');
    const from = circuit.nodes.find(n => n.id === w.from);
    const to = circuit.nodes.find(n => n.id === w.to);
    if (!from || !to || from.type === 'OUTPUT' || !Number.isInteger(w.port) || w.port < 0 || w.port >= TYPES[to.type].inputs) throw new Error('连线端口无效。');
    const key = `${w.to}:${w.port}`;
    if (occupied.has(key)) throw new Error('同一输入端口不能连接两根导线。');
    occupied.add(key);
  }
  return circuit;
}

function feedbackNodes(circuit) {
  const outgoing = new Map(circuit.nodes.map(n => [n.id, []]));
  circuit.wires.forEach(w => outgoing.get(w.from).push(w.to));
  const visited = new Set(), active = new Set(), path = [], cyclic = new Set();
  function visit(id) {
    if (active.has(id)) { path.slice(path.indexOf(id)).forEach(node => cyclic.add(node)); return; }
    if (visited.has(id)) return;
    visited.add(id); active.add(id); path.push(id);
    outgoing.get(id).forEach(visit);
    path.pop(); active.delete(id);
  }
  circuit.nodes.forEach(n => visit(n.id));
  return cyclic;
}

export function evaluate(circuit, assignment = {}) {
  const values = new Map(), reasons = new Map();
  for (const id of feedbackNodes(circuit)) {
    values.set(id, null);
    reasons.set(id, '检测到反馈回路；当前仅支持组合逻辑。');
  }
  const nodes = new Map(circuit.nodes.map(n => [n.id, n]));
  const incoming = new Map(circuit.wires.map(w => [`${w.to}:${w.port}`, w.from]));
  function visit(id) {
    if (values.has(id)) return values.get(id);
    const n = nodes.get(id);
    let value;
    if (n.type === 'INPUT') value = Object.hasOwn(assignment, id) ? assignment[id] : n.value;
    else {
      const ports = Array.from({ length: TYPES[n.type].inputs }, (_, i) => incoming.get(`${id}:${i}`));
      const args = ports.map(source => source ? visit(source) : null);
      if (ports.some(source => !source)) reasons.set(id, '输入端口未连接。');
      else if (args.includes(null)) reasons.set(id, '上游信号未定义，请沿导线检查源头。');
      if (args.includes(null)) value = null;
      else {
        const [a, b] = args;
        value = ({ AND: () => a & b, OR: () => a | b, NOT: () => 1 - a,
          XOR: () => a ^ b, NAND: () => 1 - (a & b), NOR: () => 1 - (a | b),
          XNOR: () => 1 - (a ^ b), OUTPUT: () => a })[n.type]();
      }
    }
    values.set(id, value);
    return value;
  }
  circuit.nodes.forEach(n => visit(n.id));
  return { values, reasons };
}

export function truthTable(circuit) {
  const inputs = inputsOf(circuit), outputs = outputsOf(circuit);
  return Array.from({ length: 2 ** inputs.length }, (_, index) => {
    const bits = inputs.map((_, i) => (index >> (inputs.length - i - 1)) & 1);
    const result = evaluate(circuit, Object.fromEntries(inputs.map((n, i) => [n.id, bits[i]])));
    return { bits, outputs: outputs.map(n => result.values.get(n.id)) };
  });
}

export function minimize(bits, names) { return minimizeDetails(bits, names).expression; }

export function minimizeDetails(bits, names) {
  if (bits.some(v => v !== 0 && v !== 1)) return { expression: '信号未定义', groups: [] };
  const minterms = bits.flatMap((v, i) => v === 1 ? [i] : []);
  if (!minterms.length) return { expression: '0', groups: [] };
  if (minterms.length === bits.length) return { expression: '1', groups: [{ pattern: '-'.repeat(names.length), covers: minterms, term: '1' }] };
  let current = minterms.map(i => ({ pattern: i.toString(2).padStart(names.length, '0'), covers: new Set([i]) }));
  const primes = [];
  while (current.length) {
    const used = new Set(), next = new Map();
    for (let i = 0; i < current.length; i++) for (let j = i + 1; j < current.length; j++) {
      const a = current[i], b = current[j];
      const diff = [...a.pattern].map((c, k) => c !== b.pattern[k] ? k : -1).filter(k => k >= 0);
      if (diff.length === 1 && a.pattern[diff[0]] !== '-' && b.pattern[diff[0]] !== '-') {
        used.add(i); used.add(j);
        const pattern = [...a.pattern].map((c, k) => k === diff[0] ? '-' : c).join('');
        const covers = new Set([...(next.get(pattern)?.covers || []), ...a.covers, ...b.covers]);
        next.set(pattern, { pattern, covers });
      }
    }
    current.forEach((term, i) => { if (!used.has(i)) primes.push(term); });
    current = [...next.values()];
  }
  let best = null, bestCost = Infinity;
  function search(remaining, selected) {
    const cost = selected.length * 100 + selected.reduce((sum, i) => sum + primes[i].pattern.replaceAll('-', '').length, 0);
    if (cost >= bestCost) return;
    if (!remaining.length) { best = selected; bestCost = cost; return; }
    const target = remaining[0];
    primes.forEach((term, i) => {
      if (term.covers.has(target)) search(remaining.filter(m => !term.covers.has(m)), [...selected, i]);
    });
  }
  search(minterms, []);
  const groups = best.map(i => ({
    pattern: primes[i].pattern,
    covers: [...primes[i].covers].sort((a, b) => a - b),
    term: [...primes[i].pattern].map((c, k) => c === '-' ? '' : (c === '0' ? '¬' : '') + names[k]).filter(Boolean).join(' · '),
  }));
  return { expression: groups.map(group => group.term).join(' + '), groups };
}

export function diagnose(circuit) {
  const result = evaluate(circuit), issues = [];
  if (!inputsOf(circuit).length) issues.push({ id: null, message: '添加至少一个输入开关。' });
  if (!outputsOf(circuit).length) issues.push({ id: null, message: '添加输出灯，才能生成输出真值表。' });
  for (const n of circuit.nodes) if (result.reasons.has(n.id)) issues.push({ id: n.id, message: `${n.label}：${result.reasons.get(n.id)}` });
  return issues;
}

export function connect(circuit, from, to, port) {
  const next = copy(circuit);
  next.wires = next.wires.filter(w => !(w.to === to && w.port === port));
  next.wires.push({ from, to, port });
  validate(next);
  if (feedbackNodes(next).size) throw new Error('这条线会形成反馈回路，请连接下游元件。');
  return next;
}

export function explain(circuit, id) {
  const n = circuit.nodes.find(node => node.id === id);
  if (!n) return { title: '点击一个元件', text: '选中逻辑门，查看它的输入、电平和运算规则。' };
  const { values, reasons } = evaluate(circuit), value = values.get(id);
  if (n.type === 'INPUT') return { title: `${n.label} · 输入开关`, text: `当前输入为 ${value}。点击开关切换 0 / 1，信号会沿导线实时传递。` };
  if (reasons.has(id)) return { title: `${n.label} · 信号未定义`, text: reasons.get(id) };
  const args = Array.from({ length: TYPES[n.type].inputs }, (_, port) => {
    const wire = circuit.wires.find(w => w.to === id && w.port === port);
    const source = circuit.nodes.find(node => node.id === wire?.from);
    return `${source.label} = ${values.get(source.id)}`;
  });
  const rules = { AND: '两个输入都为 1，输出才为 1。', OR: '至少一个输入为 1，输出就为 1。', NOT: '输出与输入相反。', XOR: '两个输入不同，输出为 1。', NAND: '先做与运算，再取反。', NOR: '先做或运算，再取反。', XNOR: '两个输入相同，输出为 1。', OUTPUT: '输出灯显示上游信号。' };
  return { title: `${n.label} · ${TYPES[n.type].label}`, text: `${args.join('，')} → 输出 ${value}。${rules[n.type]}` };
}

const node = (id, type, label, x, y, value = 0) => ({ id, type, label, x, y, ...(type === 'INPUT' ? { value } : {}) });
export const EXAMPLES = {
  half: { name: '半加器', note: '把两个一位二进制数相加：S 是和，C 是进位。', nodes: [node('a','INPUT','A',70,130), node('b','INPUT','B',70,290), node('xor','XOR','XOR',330,110), node('and','AND','AND',330,310), node('s','OUTPUT','S',610,110), node('c','OUTPUT','C',610,310)], wires: [{from:'a',to:'xor',port:0},{from:'b',to:'xor',port:1},{from:'a',to:'and',port:0},{from:'b',to:'and',port:1},{from:'xor',to:'s',port:0},{from:'and',to:'c',port:0}] },
  and: { name: '双开关灯', note: '两个开关都打开，灯才会亮。', nodes: [node('a','INPUT','A',70,130),node('b','INPUT','B',70,290),node('g','AND','AND',330,210),node('y','OUTPUT','Y',610,210)], wires: [{from:'a',to:'g',port:0},{from:'b',to:'g',port:1},{from:'g',to:'y',port:0}] },
  mux: { name: '二选一选择器', note: 'S = 0 时选择 A；S = 1 时选择 B。', nodes: [node('a','INPUT','A',30,80),node('b','INPUT','B',30,300),node('s','INPUT','S',30,440),node('not','NOT','NOT',190,410),node('g1','AND','AND₁',360,130),node('g2','AND','AND₂',360,310),node('or','OR','OR',540,220),node('y','OUTPUT','Y',710,220)], wires: [{from:'s',to:'not',port:0},{from:'a',to:'g1',port:0},{from:'not',to:'g1',port:1},{from:'b',to:'g2',port:0},{from:'s',to:'g2',port:1},{from:'g1',to:'or',port:0},{from:'g2',to:'or',port:1},{from:'or',to:'y',port:0}] },
  blank: { name: '我的实验', note: '从左侧添加逻辑门，连出你的第一个电路。', nodes: [node('a','INPUT','A',70,130),node('b','INPUT','B',70,290),node('y','OUTPUT','Y',610,210)], wires: [] },
};
