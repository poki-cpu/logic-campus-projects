import { inputsOf, outputsOf, truthTable, diagnose } from './shared/engine.mjs';
export const LEVELS = [
  {
    id: 'first-light', title: '第一束光', chapter: '唤醒', subtitle: '接通黑暗中的第一座信标。',
    mission: '把开关 A 的信号直接传给灯塔 Y。开关打开时亮起，关闭时熄灭。',
    inputs: ['A'], outputs: ['Y'], allowed: [], maxGates: 0, par: 0, rule: ([a]) => [a],
    hints: ['观察两种开关状态：灯塔应与开关同亮、同灭。', '信号不需要改变，导线本身就能传递 0 和 1。', '点击 A 右边的输出圆点，再点击 Y 左边的输入圆点，无需添加门。'],
    concept: '导线传递信号。0 是关闭，1 是开启。', target: 'Y = A',
  },
  {
    id: 'opposite', title: '逆光而行', chapter: '唤醒', subtitle: '有些光，只有在黑暗中才亮起。',
    mission: '制作一盏夜灯：开关 A 关闭时灯亮，打开时灯灭。',
    inputs: ['A'], outputs: ['Y'], allowed: ['NOT'], maxGates: 2, par: 1, rule: ([a]) => [1-a],
    hints: ['白天不需要夜灯，黑夜才需要。输出总与输入相反。', '找一个能把 0、1 对调的门，只翻转一次即可。', '添加一个 NOT。连接 A → NOT 输入，再连接 NOT 输出 → Y。'],
    concept: '非门 NOT：输出永远与输入相反。', target: 'Y = ¬A',
  },
  {
    id: 'two-keys', title: '双钥之门', chapter: '联结', subtitle: '一个人的力量，还不够。',
    mission: '修复安全门：只有 A、B 两把钥匙同时打开，门灯 Y 才能亮起。',
    inputs: ['A','B'], outputs: ['Y'], allowed: ['AND','OR','NOT'], maxGates: 3, par: 1, rule: ([a,b]) => [a&b],
    hints: ['四种钥匙组合中，只有 11 能开门；少一把也不行。', '把“两个条件必须同时成立”交给一个双输入门。', '添加一个 AND，A、B 分别接它的两个输入，AND 输出接 Y。'],
    concept: '与门 AND：所有条件成立，结果才成立。', target: 'Y = A · B',
  },
  {
    id: 'backup', title: '备用能源', chapter: '联结', subtitle: '只要还有一份能源，城市就不会熄灭。',
    mission: 'A 和 B 是两路电源。至少有一路开启时，信标 Y 都应点亮。',
    inputs: ['A','B'], outputs: ['Y'], allowed: ['AND','OR','XOR'], maxGates: 3, par: 1, rule: ([a,b]) => [a|b],
    hints: ['只有两路都断电才熄灭。特别注意：11 时也必须亮。', '需要“至少一个成立”的门，而不是“恰好一个成立”的门。', '添加一个 OR，A、B 分别接它的两个输入，OR 输出接 Y。'],
    concept: '或门 OR：至少一个条件成立即可。', target: 'Y = A + B',
  },
  {
    id: 'different', title: '错位共鸣', chapter: '共鸣', subtitle: '不同，才会产生共鸣。',
    mission: '只有 A、B 状态不同，水晶 Y 才发光。两者相同时必须熄灭。',
    inputs: ['A','B'], outputs: ['Y'], allowed: ['AND','OR','NOT','XOR'], maxGates: 5, par: 1, rule: ([a,b]) => [a^b],
    hints: ['比较 01、10 与 00、11：恰好一个信号开启时才共鸣。', '找一个判断“两个输入是否不同”的门；普通或门不能排除 11。', '添加一个 XOR，A、B 分别接它的两个输入，XOR 输出接 Y。'],
    concept: '异或门 XOR 是二进制加法「和」的基础。', target: 'Y = A ⊕ B',
  },
  {
    id: 'universal', title: '万能碎片', chapter: '共鸣', subtitle: '手中只有一种碎片，也能重建逻辑。',
    mission: '只用与非门，实现与门的效果：仅当 A、B 同时为 1，Y 才亮起。',
    inputs: ['A','B'], outputs: ['Y'], allowed: ['NAND'], maxGates: 4, par: 2, rule: ([a,b]) => [a&b],
    hints: ['目标与双钥之门相同，但一块与非碎片的输出恰好相反。', '两次翻转会还原信号。让第二块碎片的两个输入接收同一个值，它就能负责翻转。', 'A、B 接第一个 NAND；其输出分两根线接第二个 NAND 的两个输入；第二个输出接 Y。'],
    concept: '把与非门的两个输入接到同一信号，它就变成一个非门。', target: '仅用 NAND：Y = A · B',
  },
  {
    id: 'half-adder', title: '双路新光', chapter: '重启', subtitle: '一次加法，点亮两条不同的线路。',
    mission: '把 A 和 B 两位二进制数相加。S 显示和的低位，C 显示进位。注意 1 + 1 = 二进制 10。',
    inputs: ['A','B'], outputs: ['S','C'], allowed: ['AND','OR','NOT','XOR'], maxGates: 6, par: 2, rule: ([a,b]) => [a^b,a&b],
    hints: ['分别观察两个输出：01、10 的和低位为 1；只有 11 会进位。', '把任务拆成两条支路：一条判断输入不同，一条判断同时开启。输入可以分叉。', 'A、B 同时送入 XOR 和 AND；XOR 输出接 S（和），AND 输出接 C（进位）。'],
    concept: '半加器：异或负责求和，与门负责进位。下一步，把分支逻辑组合成城市的路由中枢。', target: '二进制加法：C S = A + B',
  },
  {
    id: 'selector', title: '岔路信号', chapter: '重启', subtitle: '最后，重启城市的信号路由中枢。',
    mission: '选择开关 S = 0 时，让 Y 跟随 A；S = 1 时，让 Y 跟随 B。',
    inputs: ['A','B','S'], outputs: ['Y'], allowed: ['AND','OR','NOT'], maxGates: 6, par: 4, rule: ([a,b,s]) => [s ? b : a],
    hints: ['选择开关只决定走哪条路；未被选中的输入不应影响输出。', '先把 A、B 分成两个有条件放行的支路，再汇合。两条支路的放行条件必须相反。', 'S 经 NOT 得到 ¬S；A 与 ¬S 接第一个 AND，B 与 S 接第二个 AND；两路 AND 输出接 OR，再接 Y。'],
    concept: '数据选择器把被选中的信号送到输出。从一根导线到多路路由，你已接通城市的逻辑网络。', target: 'S = 0 传递 A；S = 1 传递 B',
  },
];
export function createCircuit(level) {
  const inputs = level.inputs.map((label,i) => ({ id:'in'+i,type:'INPUT',label,x:70,y:level.inputs.length === 1 ? 225 : 105+i*150,value:0 }));
  const outputs = level.outputs.map((label,i) => ({ id:'out'+i,type:'OUTPUT',label,x:690,y:level.outputs.length === 1 ? 225 : 135+i*200 }));
  return { nodes:[...inputs,...outputs],wires:[] };
}
export function checkSolution(level, circuit) {
  const gates = circuit.nodes.filter(n => !['INPUT','OUTPUT'].includes(n.type));
  if (gates.length > level.maxGates || gates.some(n => !level.allowed.includes(n.type))) return { error:'电路包含本关不能使用的元件。', rows:[], passed:false };
  const inputs = inputsOf(circuit), outputs = outputsOf(circuit);
  if (inputs.length !== level.inputs.length || outputs.length !== level.outputs.length || inputs.some((n,i) => n.id !== 'in'+i || n.label !== level.inputs[i]) || outputs.some((n,i) => n.id !== 'out'+i || n.label !== level.outputs[i])) return { error:'关卡的输入与输出已被修改，请重置本关。', rows:[], passed:false };
  const rows = truthTable(circuit).map(row => ({ ...row, expected:level.rule(row.bits), pass:row.outputs.every((v,i) => v === level.rule(row.bits)[i]) }));
  const issues = diagnose(circuit);
  return { rows, passed:rows.every(row => row.pass) && !issues.length, error:issues.length ? '仍有未连接或信号未定义的元件。点击元件检查输入端口。' : '', gates:gates.length };
}
export function starsFor(level, gates, usedHint) { return 1 + Number(gates <= level.par) + Number(!usedHint); }
