import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, EXAMPLES, copy, validate, evaluate, truthTable, minimize, minimizeDetails, connect, diagnose } from '../shared/engine.mjs';
import { LEVELS, createCircuit, checkSolution, starsFor } from '../gate-quest/web/levels.mjs';
const gate = (type,id='g',x=350,y=220) => ({ id,type,label:id,x,y });
const wire = (from,to,port=0) => ({from,to,port});
function single(type) {
  const c = copy(EXAMPLES.and); c.nodes.find(n => n.id === 'g').type = type;
  if (TYPES[type].inputs === 1) c.wires = c.wires.filter(w => w.to !== 'g' || w.port === 0);
  return c;
}
test('all supported gates produce their exact truth tables', () => {
  const expected = { AND:[0,0,0,1], OR:[0,1,1,1], NOT:[1,1,0,0], XOR:[0,1,1,0], NAND:[1,1,1,0], NOR:[1,0,0,0], XNOR:[1,0,0,1] };
  for (const [type,values] of Object.entries(expected)) assert.deepEqual(truthTable(single(type)).map(r => r.outputs[0]),values,type);
});
test('half adder adds all four inputs correctly', () => assert.deepEqual(truthTable(EXAMPLES.half).map(r => r.outputs),[[0,0],[1,0],[1,0],[0,1]]));
test('multiplexer selects correct source for all eight inputs', () => { for (const row of truthTable(EXAMPLES.mux)) assert.equal(row.outputs[0],row.bits[2] ? row.bits[1] : row.bits[0]); });
test('unconnected ports remain unknown, even with a controlling zero', () => {
  const c = single('AND'); c.wires = c.wires.filter(w => w.from !== 'b');
  assert.equal(evaluate(c).values.get('y'),null); assert.ok(diagnose(c).some(i => i.id === 'g'));
});
test('cycles terminate and report a reason', () => {
  const c = {nodes:[gate('NOT','g'),gate('NOT','h')],wires:[wire('g','h'),wire('h','g')]};
  const result = evaluate(c); assert.equal(result.values.get('g'),null); assert.ok([...result.reasons.values()].some(v => v.includes('反馈回路')));
});
test('editor rejects self and indirect feedback loops', () => {
  assert.throws(() => connect(single('AND'),'g','g',0),/反馈回路/);
  const c = {nodes:[gate('NOT','g'),gate('NOT','h')],wires:[wire('g','h')]};
  assert.throws(() => connect(c,'h','g',0),/反馈回路/);
});
test('connecting to an occupied port replaces only that wire', () => {
  const c = connect(EXAMPLES.and,'b','g',0);
  assert.equal(c.wires.length,3); assert.equal(c.wires.find(w => w.to==='g' && w.port===0).from,'b');
  assert.equal(EXAMPLES.and.wires[0].from,'a');
});
test('malformed imports reject unknown gates, dangling wires, duplicate ports and oversized data', () => {
  assert.throws(() => validate({}),/缺少/);
  const badGate = copy(EXAMPLES.and); badGate.nodes[0].type = '__proto__'; assert.throws(() => validate(badGate),/不支持/);
  const badWire = copy(EXAMPLES.and); badWire.wires.push(wire('missing','g')); assert.throws(() => validate(badWire),/端口无效/);
  const duplicate = copy(EXAMPLES.and); duplicate.wires.push(wire('b','g')); assert.throws(() => validate(duplicate),/两根/);
  const huge = copy(EXAMPLES.and); huge.nodes = Array.from({length:61},(_,i) => gate('AND','g'+i)); assert.throws(() => validate(huge),/最多支持/);
  const invalid = copy(EXAMPLES.and); invalid.nodes[0].value = 3; assert.throws(() => validate(invalid),/只能/);
});
test('four-input limit is enforced', () => {
  const c = {nodes:Array.from({length:5},(_,i) => ({id:'i'+i,type:'INPUT',label:'i'+i,x:0,y:0,value:0})),wires:[]};
  assert.throws(() => validate(c),/4 个独立输入/);
});
function expressionValue(expression,names,bits) {
  if (expression === '0' || expression === '1') return Number(expression);
  return Number(expression.split(' + ').some(term => term.split(' · ').every(literal => {
    const negated = literal.startsWith('¬'), name = negated ? literal.slice(1) : literal;
    const value = bits[names.indexOf(name)]; return negated ? value === 0 : value === 1;
  })));
}
test('minimizer preserves all 256 three-input Boolean functions', () => {
  const names = ['A','B','C'];
  for (let f=0;f<256;f++) {
    const values = Array.from({length:8},(_,i) => (f>>i)&1), expression = minimize(values,names);
    for (let row=0;row<8;row++) assert.equal(expressionValue(expression,names,[(row>>2)&1,(row>>1)&1,row&1]),values[row],`function ${f} expression ${expression}`);
  }
});
test('four-input minimization matches fixed-seed functions and constants', () => {
  const names = ['A','B','C','D']; let state = 721;
  for (let i=0;i<300;i++) {
    state = (Math.imul(state,1664525)+1013904223) >>> 0;
    const f = i===0 ? 0 : i===1 ? 65535 : state&65535;
    const values = Array.from({length:16},(_,r) => (f>>r)&1), expression = minimize(values,names);
    for (let row=0;row<16;row++) assert.equal(expressionValue(expression,names,[3,2,1,0].map(shift => (row>>shift)&1)),values[row],expression);
  }
  assert.equal(minimize([0,null,1,1],['A','B']),'信号未定义');
  assert.equal(minimize([0,0,1,1],['A','B']),'A');
});
function solve(i) {
  const c = createCircuit(LEVELS[i]);
  i = ['first-light','opposite','two-keys','backup','different','universal','selector','half-adder'].indexOf(LEVELS[i].id);
  const add = (type,id) => c.nodes.push(gate(type,id));
  const w = (from,to,p=0) => c.wires.push(wire(from,to,p));
  if (i===0) w('in0','out0');
  if ([1,2,3,4].includes(i)) {
    add(['','NOT','AND','OR','XOR'][i],'g'); w('in0','g'); if(i!==1) w('in1','g',1); w('g','out0');
  }
  if (i===5) { add('NAND','g');add('NAND','h');w('in0','g');w('in1','g',1);w('g','h');w('g','h',1);w('h','out0'); }
  if (i===6) { add('NOT','n');add('AND','a');add('AND','b');add('OR','o');w('in2','n');w('in0','a');w('n','a',1);w('in1','b');w('in2','b',1);w('a','o');w('b','o',1);w('o','out0'); }
  if (i===7) { add('XOR','x');add('AND','a');for(const id of ['x','a']){w('in0',id);w('in1',id,1);}w('x','out0');w('a','out1'); }
  return c;
}
test('all eight levels have verified solutions at target gate count', () => {
  LEVELS.forEach((level,i) => { const result = checkSolution(level,validate(solve(i))); assert.equal(result.passed,true,level.title);assert.equal(result.gates,level.par); });
});
test('valid level solutions can be wired in shuffled orders with floating intermediate gates', () => {
  let seed = 437;
  LEVELS.forEach((level, i) => {
    const solution = solve(i);
    for (let attempt = 0; attempt < 20; attempt++) {
      const wires = copy(solution.wires);
      for (let j = wires.length - 1; j > 0; j--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const k = seed % (j + 1); [wires[j], wires[k]] = [wires[k], wires[j]];
      }
      let circuit = { nodes: copy(solution.nodes), wires: [] };
      for (const w of wires) circuit = connect(circuit, w.from, w.to, w.port);
      assert.equal(checkSolution(level, circuit).passed, true, level.id);
    }
  });
});
test('wrong circuits return concrete counterexamples, not just the current switch', () => {
  const c = solve(2); c.nodes.find(n => n.id==='g').type='OR';
  const result = checkSolution(LEVELS[2],c); assert.equal(result.passed,false); assert.equal(result.rows.filter(r => !r.pass).length,2);
  assert.deepEqual(result.rows.find(r => !r.pass).bits,[0,1]);
});
test('unfinished and unused floating gates cannot pass a level', () => {
  assert.equal(checkSolution(LEVELS[0],createCircuit(LEVELS[0])).passed,false);
  const c=solve(2); c.nodes.push(gate('OR','extra')); assert.equal(checkSolution(LEVELS[2],c).passed,false);
});
test('disallowed gates and changed fixed terminals reject solutions', () => {
  const c=solve(5); c.nodes.find(n=>n.id==='g').type='AND'; assert.equal(checkSolution(LEVELS[5],c).passed,false);
  const changed=solve(0); changed.nodes[0].id='other'; assert.equal(checkSolution(LEVELS[0],changed).passed,false);
  const relabeled=solve(0); relabeled.nodes[0].label='B'; assert.equal(checkSolution(LEVELS[0],relabeled).passed,false);
});
test('star rules reward passing, efficient gates and no hints independently', () => {
  assert.equal(starsFor(LEVELS[2],1,false),3);assert.equal(starsFor(LEVELS[2],2,false),2);assert.equal(starsFor(LEVELS[2],1,true),2);assert.equal(starsFor(LEVELS[2],2,true),1);
});
test('output-first wiring works while upstream ports are still floating', () => {
  const c = copy(EXAMPLES.blank); c.nodes.push(gate('AND'));
  const connected = connect(c, 'g', 'y', 0);
  assert.equal(connected.wires.length, 1);
  assert.equal(evaluate(connected).values.get('y'), null);
  assert.ok(![...evaluate(connected).reasons.values()].some(r => r.includes('反馈回路')));
  const first = connect(connected, 'a', 'g', 0), finished = connect(first, 'b', 'g', 1);
  assert.deepEqual(truthTable(finished).map(r => r.outputs[0]), [0,0,0,1]);
});
test('self and indirect cycles are rejected even with other ports floating', () => {
  const c = { nodes: [gate('AND', 'g'), gate('OR', 'h')], wires: [] };
  assert.throws(() => connect(c, 'g', 'g', 0), /反馈回路/);
  const first = connect(c, 'g', 'h', 0);
  assert.throws(() => connect(first, 'h', 'g', 0), /反馈回路/);
  const imported = { ...copy(c), wires: [wire('g','g')] };
  assert.match(evaluate(imported).reasons.get('g'), /反馈回路/);
});
test('imports reject coerced types, null wires and ambiguous input variables', () => {
  for (const type of [['AND'], { toString: () => 'AND' }, null]) {
    const c = copy(EXAMPLES.and); c.nodes[2].type = type;
    assert.throws(() => validate(c), /不支持/);
  }
  for (const label of ['', ' ', 'A · B', '¬A', '2A']) {
    const c = copy(EXAMPLES.and); c.nodes[0].label = label;
    assert.throws(() => validate(c), /变量|名称/);
  }
  const duplicate = copy(EXAMPLES.and); duplicate.nodes[1].label = 'A';
  assert.throws(() => validate(duplicate), /重复/);
  const badWire = copy(EXAMPLES.and); badWire.wires.push(null);
  assert.throws(() => validate(badWire), /端口无效/);
  const valid = copy(EXAMPLES.and); valid.nodes[0].label = 'Input_1';
  assert.equal(validate(valid), valid);
});
test('minimization groups cover only ones and preserve their displayed product terms', () => {
  const names = ['A','B','C'];
  for (let f = 0; f < 256; f++) {
    const values = Array.from({ length:8 }, (_, i) => (f >> i) & 1);
    const details = minimizeDetails(values, names), covered = new Set();
    assert.equal(details.expression, minimize(values, names));
    for (const group of details.groups) {
      assert.equal(group.covers.length, 2 ** [...group.pattern].filter(c => c === '-').length);
      for (const row of group.covers) {
        assert.equal(values[row], 1);
        assert.equal(expressionValue(group.term, names, [2,1,0].map(i => (row >> i) & 1)), 1);
        covered.add(row);
      }
    }
    assert.deepEqual([...covered].sort((a,b) => a-b), values.flatMap((v,i) => v ? [i] : []));
  }
  assert.deepEqual(minimizeDetails([0,null,1,1], ['A','B']).groups, []);
  assert.equal(minimizeDetails([1], []).expression, '1');
  assert.equal(minimizeDetails([0], []).expression, '0');
  const wrap = minimizeDetails([1,0,1,0], ['A','B']);
  assert.equal(wrap.groups[0].pattern, '-0');
  assert.deepEqual(wrap.groups[0].covers, [0,2]);
});
