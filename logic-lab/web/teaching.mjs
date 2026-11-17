export const GOALS = Object.freeze({
  free: { title: '自由探索', inputs: [], outputs: [], description: '自由搭建并观察；没有功能目标，不判定通过或失败。' },
  and: { title: '双开关灯', inputs: ['A', 'B'], outputs: ['Y'], description: 'A、B 都为 1 时灯 Y 才亮：Y = A · B。', expected: ({ A, B }) => [A & B] },
  half: { title: '半加器', inputs: ['A', 'B'], outputs: ['S', 'C'], description: '两个一位数相加：和 S = A ⊕ B，进位 C = A · B。', expected: ({ A, B }) => [A ^ B, A & B] },
  mux: { title: '选择器', inputs: ['A', 'B', 'S'], outputs: ['Y'], description: 'S = 0 时 Y = A；S = 1 时 Y = B。', expected: ({ A, B, S }) => [S ? B : A] },
});

export function goalForCircuit(circuit) {
  if (typeof circuit.labGoal === 'string' && Object.hasOwn(GOALS, circuit.labGoal)) return circuit.labGoal;
  const examples = { '半加器': 'half', '双开关灯': 'and', '二选一选择器': 'mux', '找错练习 · 半加器': 'half' };
  return typeof circuit.name === 'string' && Object.hasOwn(examples, circuit.name) ? examples[circuit.name] : 'free';
}

export function goalCases(goalId) {
  const goal = Object.hasOwn(GOALS, goalId) ? GOALS[goalId] : null;
  if (!goal?.expected) return [];
  return Array.from({ length: 2 ** goal.inputs.length }, (_, index) => {
    const bits = goal.inputs.map((_, i) => (index >> (goal.inputs.length - i - 1)) & 1);
    const labels = Object.fromEntries(goal.inputs.map((name, i) => [name, bits[i]]));
    return { index, bits, labels, expected: goal.expected(labels) };
  });
}

export function matchGoal(circuit, goalId) {
  const goal = Object.hasOwn(GOALS, goalId) ? GOALS[goalId] : null, errors = [], inputs = [], outputs = [];
  if (!goal) return { ok: false, errors: ['未知实验目标。'], inputs, outputs };
  if (goalId === 'free') return { ok: true, errors, inputs, outputs };
  for (const [type, labels, mapped, title] of [['INPUT', goal.inputs, inputs, '输入'], ['OUTPUT', goal.outputs, outputs, '输出']]) {
    const terminals = circuit.nodes.filter(n => n.type === type);
    for (const label of labels) {
      const matches = terminals.filter(n => n.label === label);
      if (matches.length === 1) mapped.push(matches[0]);
      else errors.push(matches.length ? `${title}标签「${label}」重复（${matches.length} 个），无法唯一映射。` : `缺少${title}「${label}」。`);
    }
    for (const node of terminals.filter(n => !labels.includes(n.label))) errors.push(`多余${title}「${node.label}」；此目标只接受 ${labels.join('、')}。`);
  }
  return { ok: errors.length === 0, errors, inputs, outputs };
}

export function checkGoal(circuit, goalId, evaluate) {
  const mapping = matchGoal(circuit, goalId), cases = goalCases(goalId);
  if (goalId === 'free') return { status: 'free', mapping, rows: [], firstFailure: null };
  if (!mapping.ok) return { status: 'mismatch', mapping, rows: cases, firstFailure: null };
  const inputOrder = circuit.nodes.filter(n => n.type === 'INPUT');
  const rows = cases.map(row => {
    const assignment = Object.fromEntries(mapping.inputs.map((n, i) => [n.id, row.bits[i]]));
    const values = evaluate(circuit, assignment).values;
    const actual = mapping.outputs.map(n => values.get(n.id) ?? null);
    const failures = mapping.outputs.flatMap((n, i) => actual[i] === row.expected[i] ? [] : [{ id: n.id, label: n.label, expected: row.expected[i], actual: actual[i] }]);
    return { ...row, assignment, editorBits: inputOrder.map(n => assignment[n.id]), actual, failures, pass: failures.length === 0 };
  });
  const firstFailure = rows.find(row => !row.pass) || null;
  return { status: firstFailure ? 'failed' : 'passed', mapping, rows, firstFailure };
}

// Bound the displayed paths without truncating the highlighted candidate nodes.
export function traceUpstream(circuit, outputIds, maxPaths = 24) {
  const nodes = new Map(circuit.nodes.map(n => [n.id, n]));
  const incoming = new Map();
  for (const wire of circuit.wires) {
    if (!incoming.has(wire.to)) incoming.set(wire.to, []);
    incoming.get(wire.to).push(wire);
  }
  for (const wires of incoming.values()) wires.sort((a, b) => a.port - b.port);
  const nodeIds = new Set(), pending = [...outputIds];
  while (pending.length) {
    const id = pending.pop();
    if (!nodes.has(id) || nodeIds.has(id)) continue;
    nodeIds.add(id);
    for (const wire of incoming.get(id) || []) pending.push(wire.from);
  }
  const paths = [];
  let truncated = false;
  function visit(id, chain) {
    if (paths.length >= maxPaths) { truncated = true; return; }
    if (chain.includes(id)) { paths.push({ nodes: [...chain, id], cycle: true }); return; }
    const next = [...chain, id], sources = incoming.get(id) || [];
    if (!sources.length) { paths.push({ nodes: next, cycle: false }); return; }
    for (const wire of sources) {
      visit(wire.from, next);
      if (truncated) break;
    }
  }
  for (const id of outputIds.filter(id => nodes.has(id))) visit(id, []);
  return { nodeIds: [...nodeIds], paths, truncated };
}

export function makeDebugExercise(halfAdder) {
  const circuit = structuredClone(halfAdder);
  const output = circuit.nodes.find(n => n.type === 'OUTPUT' && n.label === 'S');
  const source = circuit.wires.find(w => w.to === output?.id && w.port === 0)?.from;
  const gate = circuit.nodes.find(n => n.id === source);
  if (gate?.type !== 'XOR') throw new Error('找错练习需要标准半加器示例。');
  gate.type = 'OR'; gate.label = 'OR';
  circuit.name = '找错练习 · 半加器'; circuit.labGoal = 'half';
  circuit.note = '接线完整不等于功能正确。检测全部组合，再沿失败输出的上游候选路径排查。';
  return circuit;
}

export const grayCodes = count => Array.from({ length: 2 ** count }, (_, i) => count ? (i ^ (i >> 1)).toString(2).padStart(count, '0') : '');

export function describeGroup(group, names) {
  const retained = [], eliminated = [];
  [...group.pattern].forEach((value, i) => {
    if (value === '-') eliminated.push(names[i]);
    else retained.push({ name: names[i], value: Number(value) });
  });
  return { retained, eliminated };
}

export function kmapModel(bits, names, minimizeDetails) {
  const rowCount = Math.floor(names.length / 2), rowCodes = grayCodes(rowCount), colCodes = grayCodes(names.length - rowCount);
  const cells = rowCodes.map(row => colCodes.map(col => parseInt(row + col || '0', 2)));
  const details = minimizeDetails(bits, names);
  const unknown = bits.some(value => value !== 0 && value !== 1);
  const groups = (unknown ? [] : details.groups).map(group => {
    const covers = new Set(group.covers);
    return {
      ...group, ...describeGroup(group, names),
      wrapsColumns: colCodes.length > 2 && cells.some(row => covers.has(row[0]) && covers.has(row.at(-1))),
      wrapsRows: rowCodes.length > 2 && cells[0].some((cell, i) => covers.has(cell) && covers.has(cells.at(-1)[i])),
    };
  });
  return { expression: details.expression, groups, unknown, rowCount, rowCodes, colCodes, cells };
}

export function csvCell(value) {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
