import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor, changeKind, nextLabel, placement, gateIcon } from '../shared/editor.mjs';
import { EXAMPLES, copy } from '../shared/engine.mjs';
const surface = () => ({ ownerDocument: { activeElement: null }, addEventListener() {}, contains() { return false; }, innerHTML: '' });
test('new nodes use unoccupied space and unique names after deletions', () => {
  const editor = new Editor(surface(), EXAMPLES.half);
  editor.add('INPUT'); editor.add('INPUT');
  const inputs = editor.circuit.nodes.filter(n => n.type === 'INPUT');
  assert.equal(new Set(inputs.map(n => n.label)).size, 4);
  assert.notDeepEqual([inputs[2].x, inputs[2].y], [inputs[3].x, inputs[3].y]);
  for (const n of inputs.slice(2)) assert.ok(editor.circuit.nodes.every(other => other.id === n.id || Math.abs(n.x - other.x) >= 132 || Math.abs(n.y - other.y) >= 96));
  assert.equal(nextLabel('AND', [{ label:'AND' }, { label:'AND3' }]), 'AND2');
  assert.equal(placement([]).x, 300);
});
test('invalid import preserves circuit, selection, pending connection and history', () => {
  const editor = new Editor(surface(), EXAMPLES.and);
  editor.selected = 'g'; editor.pending = 'a';
  const before = copy(editor.circuit), bad = copy(before); bad.nodes[2].type = ['AND'];
  assert.throws(() => editor.load(bad), /不支持/);
  assert.deepEqual(editor.circuit, before);
  assert.equal(editor.selected, 'g'); assert.equal(editor.pending, 'a');
  assert.equal(editor.history.length, 0);
});
test('input and layout changes including undo do not invalidate functional tests', () => {
  const events = [], editor = new Editor(surface(), EXAMPLES.and, { onChange: (_, edit, kind) => events.push([edit, kind]) });
  editor.setInputs([1,1]);
  assert.deepEqual(events.pop(), [false,'input']);
  const next = copy(editor.circuit); next.nodes[0].value = 0;
  editor.commit(next, 'input'); editor.undo(); editor.redo();
  assert.deepEqual(events.splice(0), [[false,'input'],[false,'input'],[false,'input']]);
  const layout = copy(editor.circuit); layout.nodes[0].x += 10;
  editor.commit(layout, 'layout'); editor.undo();
  assert.deepEqual(events.splice(0), [[false,'layout'],[false,'layout']]);
  const topology = copy(editor.circuit); topology.wires.pop();
  editor.commit(topology); editor.undo();
  assert.deepEqual(events.splice(0), [[true,'topology'],[true,'topology']]);
  assert.equal(changeKind(EXAMPLES.and, EXAMPLES.half), 'topology');
});
test('keyboard activation is not swallowed by a preceding pointer click guard', () => {
  const editor = new Editor(surface(), EXAMPLES.and);
  editor.ignoreClick = true;
  editor.click({ type:'keydown', target:{ closest: selector => selector === '[data-source]' ? { dataset:{ source:'a' } } : null } });
  assert.equal(editor.pending, 'a');
});

test('gate icons use distinct shapes, explicit inversion bubbles and XOR input curves', () => {
  const shapes = new Map();
  for (const type of ['AND', 'OR', 'NOT', 'XOR', 'NAND', 'NOR', 'XNOR']) {
    const svg = gateIcon(type);
    assert.equal((svg.match(/class="inversion-bubble"/g) || []).length, ['NOT', 'NAND', 'NOR', 'XNOR'].includes(type) ? 1 : 0);
    assert.equal((svg.match(/class="xor-curve"/g) || []).length, ['XOR', 'XNOR'].includes(type) ? 1 : 0);
    assert.doesNotMatch(svg, /[\u0300-\u036f]/);
    assert.equal((svg.match(/class="gate-pin symbol-pin"/g) || []).length, type === 'NOT' ? 2 : 3);
    shapes.set(type, svg.match(/<path d="([^"]+)" class="gate-outline"/)[1]);
  }
  assert.equal(shapes.get('AND'), shapes.get('NAND'));
  assert.equal(shapes.get('OR'), shapes.get('NOR'));
  assert.equal(shapes.get('XOR'), shapes.get('XNOR'));
  assert.notEqual(shapes.get('AND'), shapes.get('OR'));
  assert.notEqual(shapes.get('NOT'), shapes.get('OR'));
});

test('rendered gate outputs and individual input ports match every truth-table row', () => {
  const expected = { AND: [0,0,0,1], OR: [0,1,1,1], NOT: [1,1,0,0], XOR: [0,1,1,0], NAND: [1,1,1,0], NOR: [1,0,0,0], XNOR: [1,0,0,1] };
  for (const [type, rows] of Object.entries(expected)) for (let row = 0; row < 4; row++) {
    const circuit = copy(EXAMPLES.and); circuit.nodes.find(n => n.id === 'g').type = type;
    if (type === 'NOT') circuit.wires = circuit.wires.filter(w => !(w.to === 'g' && w.port === 1));
    const svg = surface(), editor = new Editor(svg, circuit);
    editor.setInputs([row >> 1, row & 1]);
    assert.match(svg.innerHTML, new RegExp(`data-node="g" data-signal="${rows[row]}"`));
    assert.match(svg.innerHTML, new RegExp(`data-port="0" data-target="g" data-signal="${row >> 1}"`));
    if (type !== 'NOT') assert.match(svg.innerHTML, new RegExp(`data-port="1" data-target="g" data-signal="${row & 1}"`));
    assert.match(svg.innerHTML, new RegExp(`data-source="g" data-signal="${rows[row]}"`));
  }
});

test('floating ports, driven zero and undefined outputs remain visually distinguishable', () => {
  const circuit = copy(EXAMPLES.and); circuit.wires = circuit.wires.filter(w => w.from !== 'b');
  const svg = surface(), editor = new Editor(svg, circuit, { highlight: ['a', 'g', 'y'] });
  assert.match(svg.innerHTML, /data-target="g" data-signal="0"/);
  assert.match(svg.innerHTML, /data-port="1" data-target="g" data-signal="\?"/);
  assert.match(svg.innerHTML, /data-source="g" data-signal="\?"/);
  assert.match(svg.innerHTML, /class="wire signal-\?"/);
  assert.match(svg.innerHTML, /class="wire-highlight"/);
  assert.doesNotMatch(svg.innerHTML, /class="inversion-bubble"/);
  const originalPorts = circuit.nodes.map(n => [editor.port(n, 0), editor.port(n, 0, true)]);
  editor.render();
  assert.deepEqual(circuit.nodes.map(n => [editor.port(n, 0), editor.port(n, 0, true)]), originalPorts);
});

test('long labels are escaped and shortened visually while full accessible names remain', () => {
  const circuit = copy(EXAMPLES.and), label = '输出<&"很长的测试标签123456789';
  circuit.nodes.find(n => n.type === 'OUTPUT').label = label;
  const svg = surface(); new Editor(svg, circuit);
  assert.match(svg.innerHTML, /输出&lt;&amp;&quot;很长的测试标签123456789/);
  assert.match(svg.innerHTML, /class="node-label">输出&lt;&amp;&quot;很长的测…<\/text>/);
  assert.doesNotMatch(svg.innerHTML, /NaN|undefined/);
});

test('inversion marks stay outside output-port hit areas and reverse wires stay within the board', () => {
  for (const type of ['NOT', 'NAND', 'NOR', 'XNOR']) {
    const svg = surface(), circuit = { nodes: [{ id: 'a', type: 'INPUT', label: 'A', value: 0, x: 750, y: 0 }, { id: 'g', type, label: type, x: 0, y: 480 }], wires: [{ from: 'a', to: 'g', port: 0 }] };
    new Editor(svg, circuit);
    const bubble = /<circle cx="([\d.]+)" cy="32" r="5" class="inversion-bubble"/.exec(svg.innerHTML);
    const hit = /data-source="g"[\s\S]*?<rect x="([\d.]+)"/.exec(svg.innerHTML);
    assert.ok(Number(bubble[1]) + 6 < Number(hit[1]));
    const path = /<path d="([^"]+)" class="wire signal-0"/.exec(svg.innerHTML)[1];
    const coordinates = path.match(/[\d.]+/g).map(Number);
    for (let i = 0; i < coordinates.length; i += 2) {
      assert.ok(coordinates[i] >= 0 && coordinates[i] <= 880);
      assert.ok(coordinates[i + 1] >= 0 && coordinates[i + 1] <= 560);
    }
  }
});
