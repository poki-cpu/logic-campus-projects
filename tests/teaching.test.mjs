import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as engine from '../shared/engine.mjs';
import * as editorModule from '../shared/editor.mjs';
import * as teaching from '../logic-lab/web/teaching.mjs';
const { EXAMPLES, copy, evaluate, minimizeDetails, truthTable, inputsOf, outputsOf } = engine;
const { GOALS, goalForCircuit, goalCases, matchGoal, checkGoal, traceUpstream, makeDebugExercise, grayCodes, describeGroup, kmapModel, csvCell } = teaching;

test('default examples have explicit goals; custom and prototype names are safe', () => {
  assert.equal(goalForCircuit(EXAMPLES.half), 'half');
  assert.equal(goalForCircuit(EXAMPLES.and), 'and');
  assert.equal(goalForCircuit(EXAMPLES.mux), 'mux');
  assert.equal(goalForCircuit(EXAMPLES.blank), 'free');
  assert.equal(goalForCircuit({ name: '__proto__', labGoal: '__proto__' }), 'free');
  assert.equal(goalForCircuit({ ...EXAMPLES.half, labGoal: 'free' }), 'free');
  assert.equal(matchGoal(EXAMPLES.half, '__proto__').ok, false);
  assert.equal(goalForCircuit({ name: { toString: null }, labGoal: ['half'] }), 'free');
});

test('every experiment enumerates all expected combinations and passes its example', () => {
  for (const id of ['and', 'half', 'mux']) {
    const result = checkGoal(EXAMPLES[id], id, evaluate);
    assert.equal(result.status, 'passed');
    assert.equal(result.rows.length, 2 ** GOALS[id].inputs.length);
    assert.equal(result.firstFailure, null);
  }
  assert.deepEqual(goalCases('half').map(row => row.expected), [[0, 0], [1, 0], [1, 0], [0, 1]]);
  assert.equal(checkGoal(EXAMPLES.blank, 'free', evaluate).status, 'free');
});

test('terminal mapping and replay use labels even after node order and IDs change', () => {
  const circuit = copy(EXAMPLES.mux), ids = new Map(circuit.nodes.map((node, i) => [node.id, `new${i}`]));
  circuit.nodes.reverse().forEach(node => node.id = ids.get(node.id));
  circuit.wires.forEach(wire => { wire.from = ids.get(wire.from); wire.to = ids.get(wire.to); });
  const result = checkGoal(circuit, 'mux', evaluate);
  assert.equal(result.status, 'passed');
  for (const row of result.rows) {
    inputsOf(circuit).forEach((node, i) => assert.equal(row.editorBits[i], row.labels[node.label]));
    assert.equal(evaluate(circuit, row.assignment).values.get(outputsOf(circuit)[0].id), row.expected[0]);
  }
  const half = copy(EXAMPLES.half); half.nodes.reverse();
  assert.equal(checkGoal(half, 'half', evaluate).status, 'passed');
});

test('missing, duplicate, extra or incorrectly cased terminals block judgement', () => {
  const cases = [
    circuit => circuit.nodes.splice(circuit.nodes.findIndex(n => n.label === 'S'), 1),
    circuit => circuit.nodes.find(n => n.label === 'C').label = 'S',
    circuit => circuit.nodes.push({ id: 'extra', type: 'INPUT', label: 'D', x: 0, y: 0, value: 0 }),
    circuit => circuit.nodes.find(n => n.label === 'A').label = 'a',
  ];
  for (const mutate of cases) {
    const circuit = copy(EXAMPLES.half); mutate(circuit);
    const result = checkGoal(circuit, 'half', () => { throw new Error('must not evaluate mismatched terminals'); });
    assert.equal(result.status, 'mismatch');
    assert.ok(result.mapping.errors.length);
    assert.equal(result.firstFailure, null);
    assert.equal(result.rows.length, 4);
    assert.ok(result.rows.every(row => !Object.hasOwn(row, 'actual')));
  }
});

test('OR-instead-of-XOR exercise fails only at 11 on S, without mutating the example', () => {
  const circuit = makeDebugExercise(EXAMPLES.half);
  assert.equal(circuit.labGoal, 'half');
  assert.equal(EXAMPLES.half.nodes.find(n => n.id === 'xor').type, 'XOR');
  assert.equal(engine.diagnose(circuit).length, 0, 'wiring is valid but functionality is wrong');
  const result = checkGoal(circuit, 'half', evaluate);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.rows.map(row => row.pass), [true, true, true, false]);
  assert.deepEqual(result.firstFailure.bits, [1, 1]);
  assert.deepEqual(result.firstFailure.failures, [{ id: 's', label: 'S', expected: 0, actual: 1 }]);
});

test('upstream candidates cover the failing output paths, not an unrelated correct branch', () => {
  const circuit = makeDebugExercise(EXAMPLES.half), trace = traceUpstream(circuit, ['s']);
  assert.deepEqual(new Set(trace.nodeIds), new Set(['a', 'b', 'xor', 's']));
  assert.deepEqual(trace.paths.map(path => path.nodes), [['s', 'xor', 'a'], ['s', 'xor', 'b']]);
  assert.ok(!trace.nodeIds.includes('and') && !trace.nodeIds.includes('c'));
  const bounded = traceUpstream(circuit, ['s'], 1);
  assert.equal(bounded.paths.length, 1); assert.equal(bounded.truncated, true);
  assert.deepEqual(new Set(bounded.nodeIds), new Set(trace.nodeIds));
});

test('unknown outputs fail explicitly and upstream tracing terminates for cycles', () => {
  const circuit = copy(EXAMPLES.half); circuit.wires = circuit.wires.filter(w => w.to !== 'xor');
  const result = checkGoal(circuit, 'half', evaluate);
  assert.equal(result.status, 'failed'); assert.equal(result.firstFailure.actual[0], null);
  const cycle = { nodes: [{ id: 'g', type: 'NOT' }, { id: 'h', type: 'NOT' }, { id: 'out', type: 'OUTPUT' }], wires: [{ from: 'g', to: 'h', port: 0 }, { from: 'h', to: 'g', port: 0 }, { from: 'g', to: 'out', port: 0 }] };
  const trace = traceUpstream(cycle, ['out']);
  assert.equal(trace.paths[0].cycle, true); assert.equal(trace.nodeIds.length, 3);
});

test('Gray code includes one-bit adjacency between first and last positions', () => {
  assert.deepEqual(grayCodes(0), ['']);
  assert.deepEqual(grayCodes(2), ['00', '01', '11', '10']);
  for (const count of [1, 2]) {
    const codes = grayCodes(count);
    codes.forEach((code, i) => assert.equal([...code].filter((bit, n) => bit !== codes[(i + 1) % codes.length][n]).length, 1));
  }
});

test('group descriptions retain fixed literals and eliminate changing variables', () => {
  assert.deepEqual(describeGroup({ pattern: '0-1' }, ['A', 'B', 'C']), { retained: [{ name: 'A', value: 0 }, { name: 'C', value: 1 }], eliminated: ['B'] });
});

test('Kmap consumes the shared minimizer details, exposes wraparound and exact coverage', () => {
  const bits = Array.from({ length: 16 }, (_, i) => Number(!(i & 4) && !(i & 1)));
  let calls = 0;
  const model = kmapModel(bits, ['A', 'B', 'C', 'D'], (values, names) => { calls++; assert.equal(values, bits); return minimizeDetails(values, names); });
  assert.equal(calls, 1);
  assert.equal(model.expression, '¬B · ¬D');
  assert.deepEqual(model.cells, [[0, 1, 3, 2], [4, 5, 7, 6], [12, 13, 15, 14], [8, 9, 11, 10]]);
  assert.deepEqual(model.groups[0].covers, [0, 2, 8, 10]);
  assert.equal(model.groups[0].wrapsColumns, true); assert.equal(model.groups[0].wrapsRows, true);
  assert.deepEqual(model.groups[0].eliminated, ['A', 'C']);
});

test('constant and zero-variable maps are correct; unknown signals have no groups', () => {
  for (const names of [[], ['A', 'B']]) {
    const zero = kmapModel(Array(2 ** names.length).fill(0), names, minimizeDetails);
    assert.equal(zero.expression, '0'); assert.deepEqual(zero.groups, []);
    const one = kmapModel(Array(2 ** names.length).fill(1), names, minimizeDetails);
    assert.equal(one.expression, '1'); assert.equal(one.groups.length, 1);
    assert.equal(one.groups[0].covers.length, 2 ** names.length);
    assert.deepEqual(one.groups[0].eliminated, names);
    const unknown = kmapModel(Array(2 ** names.length).fill(null), names, minimizeDetails);
    assert.equal(unknown.expression, '信号未定义'); assert.deepEqual(unknown.groups, []);
    if (!names.length) assert.deepEqual(one.cells, [[0]]);
  }
});

test('all three-variable functions use groups that cover exactly their ones', () => {
  for (let f = 0; f < 256; f++) {
    const bits = Array.from({ length: 8 }, (_, i) => (f >> i) & 1);
    const model = kmapModel(bits, ['A', 'B', 'C'], minimizeDetails);
    assert.equal(model.expression, engine.minimize(bits, ['A', 'B', 'C']));
    const covered = new Set(model.groups.flatMap(group => group.covers));
    assert.deepEqual(covered, new Set(bits.flatMap((value, i) => value === 1 ? [i] : [])));
  }
});

test('CSV cells preserve escaping and neutralize spreadsheet formula prefixes', () => {
  for (const value of ['=SUM(1,2)', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd', '\ncmd', '  =cmd']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('A"B'), '"A""B"'); assert.equal(csvCell(1), '"1"');
});

// The DOM fixture tests app handlers, not browser layout or SVG focus.
class Element {
  constructor(id = '', dataset = {}) { this.id = id; this.dataset = dataset; this.handlers = {}; this.attributes = {}; this.classes = new Set(); this.children = []; this._html = ''; this._text = ''; }
  set innerHTML(value) {
    this._html = value; this._text = value.replace(/<[^>]*>/g, ''); this.children = [];
    if (this.id === 'group-terms') for (const match of value.matchAll(/data-group="(\d+)"/g)) this.children.push(new Element('', { group: match[1] }));
    if (this.id === 'kmap') for (const match of value.matchAll(/data-map-cell="(\d+)" data-r="(\d+)" data-c="(\d+)"/g)) {
      const cell = new Element('', { mapCell: match[1], r: match[2], c: match[3] }); cell.button = new Element(); this.children.push(cell);
    }
  }
  get innerHTML() { return this._html; }
  set textContent(value) { this._text = value; this._html = ''; this.children = []; }
  get textContent() { return this._text; }
  set className(value) { this.classes = new Set(value.split(' ')); }
  get className() { return [...this.classes].join(' '); }
  get classList() { return { add: value => this.classes.add(value), toggle: (value, on) => on ? this.classes.add(value) : this.classes.delete(value) }; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll() { return this.children; }
  querySelector() { return this.button; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  dispatch(type = 'click', target = this) { for (const handler of this.handlers[type] || []) handler({ target }); }
}
const appSource = readFileSync(new URL('../logic-lab/web/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
function appFixture(saved = null) {
  const elements = new Map(), storage = new Map(), downloads = [];
  let writes = 0;
  if (saved) storage.set('logic-lab:circuit:v1', JSON.stringify(saved));
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  class FixtureEditor extends editorModule.Editor { render() { this.renderCount = (this.renderCount || 0) + 1; } }
  const context = vm.createContext({ ...engine, ...teaching, ...editorModule, Editor: FixtureEditor, document: { getElementById: get }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => { writes++; storage.set(key, value); } }, notify: () => {}, download: (...args) => downloads.push(args) });
  vm.runInContext(appSource + '\nglobalThis.fixtureEditor = editor;', context, { filename: 'logic-lab/web/app.mjs' });
  return { get, editor: context.fixtureEditor, saved: () => JSON.parse(storage.get('logic-lab:circuit:v1')), writes: () => writes, downloads };
}
const datasetTarget = dataset => ({ dataset, closest() { return this; } });

test('app defaults to half-adder target but does not confuse wiring validity with a pass', () => {
  const app = appFixture();
  assert.equal(app.get('goal-select').value, 'half');
  assert.match(app.get('goal-status').textContent, /尚未检测/);
  assert.match(app.get('diagnostics').innerHTML, /不代表功能通过/);
  app.get('goal-check').dispatch();
  assert.match(app.get('goal-status').textContent, /目标通过.*4 \/ 4/);
});

test('setInputs(false,input) and truth-table replay auto-save; selection does not', () => {
  const app = appFixture();
  app.editor.setInputs([1, 0]);
  assert.deepEqual(inputsOf(app.saved()).map(n => n.value), [1, 0]);
  const writes = app.writes(); app.editor.select('a'); assert.equal(app.writes(), writes);
  app.get('truth-table').dispatch('click', datasetTarget({ row: '3' }));
  assert.deepEqual(inputsOf(app.saved()).map(n => n.value), [1, 1]);
  const reloaded = appFixture(app.saved());
  assert.deepEqual(inputsOf(reloaded.editor.circuit).map(n => n.value), [1, 1]);
});

test('exercise runs and replays 11 with candidate highlights; undo restores prior circuit and goal', () => {
  const app = appFixture({ ...copy(EXAMPLES.and), labGoal: 'and' });
  app.editor.setInputs([0, 1]); const before = app.saved();
  app.get('debug-exercise').dispatch();
  assert.match(app.get('goal-status').textContent, /目标未通过.*1 \/ 4/);
  assert.match(app.get('goal-trace').innerHTML, /S 期望 0 \/ 实际 1/);
  assert.deepEqual(new Set(app.editor.options.highlight), new Set(['a', 'b', 'xor', 's']));
  assert.deepEqual(inputsOf(app.saved()).map(n => n.value), [1, 1]);
  app.get('undo').dispatch();
  assert.deepEqual(app.saved(), before); assert.equal(app.get('goal-select').value, 'and');
  assert.match(app.get('goal-status').textContent, /尚未检测/);
  assert.equal(app.editor.options.highlight.length, 0);
});

test('input, layout and selection retain test results; topology invalidates them, not observed inputs', () => {
  const app = appFixture(); app.get('debug-exercise').dispatch();
  app.editor.setInputs([0, 1]);
  assert.match(app.get('goal-status').textContent, /目标未通过/); assert.equal(app.editor.options.highlight.length, 0);
  app.get('first-failure').dispatch(); assert.equal(app.editor.options.highlight.length, 4);
  app.editor.select('xor'); assert.match(app.get('goal-status').textContent, /目标未通过/);
  const moved = copy(app.editor.circuit); moved.nodes.find(n => n.id === 'xor').x += 10;
  app.editor.commit(moved, 'layout');
  assert.match(app.get('goal-status').textContent, /目标未通过/); assert.equal(app.editor.options.highlight.length, 4);
  const fixed = copy(app.editor.circuit); fixed.nodes.find(n => n.id === 'xor').type = 'XOR';
  app.editor.commit(fixed);
  assert.match(app.get('goal-status').textContent, /尚未检测/); assert.equal(app.editor.options.highlight.length, 0);
  assert.deepEqual(inputsOf(app.saved()).map(n => n.value), [1, 1]);
  app.get('goal-check').dispatch(); assert.match(app.get('goal-status').textContent, /目标通过/);
});

test('goal changes preserve wiring and undo with the circuit', () => {
  const app = appFixture(), wires = copy(app.editor.circuit.wires);
  app.get('goal-select').dispatch('change', { value: 'and' });
  assert.deepEqual(app.editor.circuit.wires, wires);
  assert.match(app.get('goal-status').innerHTML, /端子不匹配/); assert.equal(app.get('goal-check').disabled, true);
  app.get('undo').dispatch(); assert.equal(app.get('goal-select').value, 'half');
});

test('formula buttons and map cells select each other without rerendering the editor', () => {
  const app = appFixture(), before = app.editor.renderCount;
  app.get('group-terms').dispatch('click', datasetTarget({ group: '1' }));
  assert.equal(app.get('group-terms').children[1].attributes['aria-pressed'], 'true');
  const covered = app.get('kmap').children.filter(cell => cell.classes.has('covered')).map(cell => Number(cell.dataset.mapCell));
  assert.deepEqual(covered, [2]);
  assert.match(app.get('group-detail').innerHTML, /保留：A=1、B=0/);
  app.get('kmap').dispatch('click', datasetTarget({ cell: '1' }));
  assert.equal(app.get('group-terms').children[0].attributes['aria-pressed'], 'true');
  assert.equal(app.get('group-terms').children[1].attributes['aria-pressed'], 'false');
  app.get('kmap').dispatch('click', datasetTarget({ cell: '0' }));
  assert.match(app.get('group-detail').textContent, /不在任何圈组/);
  assert.equal(app.editor.renderCount, before);
});

test('no-output and zero-input states remove stale map controls without throwing', () => {
  const app = appFixture();
  app.editor.load({ name: 'empty', labGoal: 'free', nodes: [], wires: [] });
  assert.equal(app.get('output-select').disabled, true); assert.equal(app.get('csv').disabled, true);
  assert.match(app.get('kmap').textContent, /添加输出/); assert.equal(app.get('group-terms').innerHTML, '');
  app.editor.load({ name: 'zero-input', labGoal: 'free', nodes: [{ id: 'out', type: 'OUTPUT', label: 'Y', x: 0, y: 0 }], wires: [] });
  assert.match(app.get('gray-note').textContent, /零变量/); assert.match(app.get('expression').textContent, /信号未定义/);
  assert.match(app.get('group-detail').textContent, /不进行圈组/);
  assert.equal(app.get('kmap').children.length, 1);
});

test('imported output labels stay escaped in panels and protected in CSV', () => {
  const circuit = copy(EXAMPLES.half); circuit.labGoal = 'half';
  circuit.nodes.find(n => n.id === 's').label = '<img src=x onerror=alert(1)>';
  circuit.nodes.find(n => n.id === 'c').label = '=1+1';
  const app = appFixture(circuit);
  for (const id of ['signal-cards', 'output-select', 'truth-table', 'goal-status']) {
    assert.ok(!app.get(id).innerHTML.includes('<img'));
    assert.ok(app.get(id).innerHTML.includes('&lt;img'));
  }
  app.get('csv').dispatch();
  assert.ok(app.downloads[0][1].includes('"\'=1+1"'));
});
