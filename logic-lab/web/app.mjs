import { TYPES, copy, validate, EXAMPLES, inputsOf, outputsOf, truthTable, minimizeDetails, evaluate, diagnose, explain } from './shared/engine.mjs';
import { Editor, esc, bit, download, notify, gateIcon } from './shared/editor.mjs';
import { GOALS, goalForCircuit, goalCases, matchGoal, checkGoal, traceUpstream, makeDebugExercise, kmapModel, csvCell } from './teaching.mjs';
const $ = id => document.getElementById(id);
const storageKey = 'logic-lab:circuit:v1';
let initial = copy(EXAMPLES.half), loadNotice = '';
try { const saved = localStorage.getItem(storageKey); if (saved) initial = validate(JSON.parse(saved)); }
catch { loadNotice = '无法读取本机存档，已载入半加器。你仍可用 JSON 导出备份。'; }
initial.labGoal = goalForCircuit(initial);
const editor = new Editor($('board'), initial, { onChange: render, highlight: [] });
editor.selected = initial.nodes.find(n => n.type === 'XOR')?.id || null; editor.render();
const paletteOrder = ['INPUT','OUTPUT','AND','OR','NOT','XOR','NAND','NOR','XNOR'];
$('palette').innerHTML = paletteOrder.map(type => `<button class="component" data-add="${type}" aria-label="添加${TYPES[type].label}"><span class="component-symbol">${gateIcon(type)}</span><span>${TYPES[type].label}<small>${type}</small></span></button>`).join('');
$('palette').addEventListener('click', event => { const button = event.target.closest('[data-add]'); if (button) editor.add(button.dataset.add); });
let table = [], outputId = null, goalResult = null, traceIndex = null, map = null, mapFocus = null;
function setHighlight(ids) {
  if (JSON.stringify(editor.options.highlight) === JSON.stringify(ids)) return;
  editor.options.highlight = ids;
  editor.render();
}
function render(_, _edited = false, kind = 'initial') {
  if (kind === 'topology') {
    goalResult = null; traceIndex = null; mapFocus = null; setHighlight([]);
  }
  const circuit = editor.circuit, inputs = inputsOf(circuit), outputs = outputsOf(circuit), state = evaluate(circuit);
  $('example').value = Object.keys(EXAMPLES).find(key => EXAMPLES[key].name === circuit.name) || 'custom';
  $('csv').disabled = !outputs.length;
  $('experiment-note').textContent = typeof circuit.note === 'string' ? circuit.note.slice(0, 200) : '你的组合逻辑实验';
  $('undo').disabled = !editor.history.length; $('redo').disabled = !editor.future.length;
  $('delete-node').disabled = !editor.selected;
  $('wire-help').textContent = editor.pending ? '正在连线：请选择下游输入端口（Esc 取消）' : '连线：点击右侧输出点，再点击左侧输入点';
  $('signal-cards').innerHTML = outputs.length ? outputs.map(n => {
    const value = state.values.get(n.id);
    return `<div class="signal-card ${value === 1 ? 'high' : ''}"><span>${esc(n.label)} <small>输出</small></span><strong>${bit(value)}</strong><small>${value === null ? '未定义' : value ? '高电平' : '低电平'}</small></div>`;
  }).join('') : '<p class="micro">添加输出灯，观察电平。</p>';
  const info = explain(circuit, editor.selected);
  $('explanation').innerHTML = `<b>${esc(info.title)}</b><p>${esc(info.text)}</p>`;
  const issues = diagnose(circuit);
  $('diagnostics').innerHTML = issues.length ? `<div class="panel-label">接线检查 · ${issues.length} 项</div>` + issues.map(issue => `<button class="diagnostic-item" ${issue.id ? `data-focus="${esc(issue.id)}"` : 'disabled'}>${esc(issue.message)}</button>`).join('') : '<div class="diagnostic-ok">接线完整，信号已定义</div><p class="micro">这不代表功能通过；请在实验目标中检测全部组合。</p>';
  table = truthTable(circuit);
  const current = inputs.map(n => n.value).join('');
  $('truth-table').innerHTML = !outputs.length ? '<p class="micro">电路还没有输出。</p>' : `<table><thead><tr>${inputs.map(n => `<th>${esc(n.label)}<small>输入</small></th>`).join('')}${outputs.map(n => `<th>${esc(n.label)}<small>输出</small></th>`).join('')}<th>复现</th></tr></thead><tbody>${table.map((row, i) => `<tr class="${row.bits.join('') === current ? 'current' : ''}" data-row="${i}">${row.bits.map(v => `<td>${v}</td>`).join('')}${row.outputs.map(v => `<td class="table-output">${bit(v)}</td>`).join('')}<td><button data-row="${i}" aria-label="复现输入 ${row.bits.join(' ') || '（无输入）'}">↗</button></td></tr>`).join('')}</tbody></table>`;
  if (!outputs.some(n => n.id === outputId)) { outputId = outputs[0]?.id || null; mapFocus = null; }
  $('output-select').disabled = !outputs.length;
  $('output-select').innerHTML = outputs.map(n => `<option value="${esc(n.id)}" ${n.id === outputId ? 'selected' : ''}>${esc(n.label)}</option>`).join('');
  renderGoal(); renderMap();
  // Input observations and layout changes must persist even when edited is false.
  if (kind !== 'selection') {
    try { localStorage.setItem(storageKey, JSON.stringify(circuit)); $('save-state').textContent = '已自动保存到本机'; }
    catch { $('save-state').textContent = '本机存储不可用，请导出备份'; }
  }
}

function renderGoal() {
  const goalId = goalForCircuit(editor.circuit), goal = GOALS[goalId], mapping = matchGoal(editor.circuit, goalId);
  $('goal-select').value = goalId;
  $('goal-description').textContent = goal.description;
  $('goal-terminals').textContent = goalId === 'free' ? '切换目标只改变对照要求，不会替换你的接线。' : `需要输入：${goal.inputs.join('、')}；输出：${goal.outputs.join('、')}。按标签精确匹配（区分大小写），不按摆放或节点顺序。`;
  $('goal-check').disabled = goalId === 'free' || !mapping.ok;
  $('first-failure').disabled = !goalResult?.firstFailure;
  const status = $('goal-status');
  status.className = 'goal-status';
  if (goalId === 'free') {
    status.textContent = '自由探索：不进行目标判定。'; $('goal-table').innerHTML = '';
  } else {
    if (!mapping.ok) {
      status.classList.add('warning');
      status.innerHTML = `<b>端子不匹配，无法检测；不能判为功能失败或通过。</b><ul>${mapping.errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul>`;
    } else if (!goalResult) status.textContent = '尚未检测。请检测全部组合；修改接线后需要重新检测。';
    else if (goalResult.status === 'passed') { status.classList.add('passed'); status.textContent = `目标通过：${goalResult.rows.length} / ${goalResult.rows.length} 组输入全部符合期望。`; }
    else {
      status.classList.add('warning');
      const failed = goalResult.rows.filter(row => !row.pass);
      status.textContent = `目标未通过：${failed.length} / ${goalResult.rows.length} 组不符（? 为未定义，不算通过）。`;
    }
    const rows = goalResult?.rows || goalCases(goalId);
    $('goal-table').innerHTML = `<table aria-label="${esc(goal.title)}目标对照"><thead><tr>${goal.inputs.map(label => `<th>${esc(label)}<small>输入</small></th>`).join('')}${goal.outputs.map(label => `<th>${esc(label)}<small>期望 / 实际</small></th>`).join('')}<th>结果 / 复现</th></tr></thead><tbody>${rows.map(row => {
      const observed = row.assignment && inputsOf(editor.circuit).every(n => row.assignment[n.id] === n.value);
      return `<tr class="${observed ? 'current' : ''} ${row.pass === false ? 'failed-row' : ''}">${row.bits.map(value => `<td>${value}</td>`).join('')}${row.expected.map((value, i) => `<td class="${row.actual && row.actual[i] !== value ? 'mismatch-cell' : ''}">${value} <span class="micro">/</span> ${row.actual ? bit(row.actual[i]) : '<span class="micro">待检测</span>'}</td>`).join('')}<td>${row.actual ? `<button class="text-button" data-goal-row="${row.index}" aria-label="复现 ${esc(goal.inputs.map((name, i) => `${name}=${row.bits[i]}`).join('，'))}${row.pass ? '，通过' : '，失败并追踪'}">${row.pass ? '通过 · 复现' : '失败 · 追踪'}</button>` : '<span class="micro">—</span>'}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  renderTrace();
}

function renderTrace() {
  const target = $('goal-trace'), first = goalResult?.firstFailure;
  if (!first) {
    traceIndex = null; setHighlight([]);
    target.innerHTML = `<p class="micro">${goalResult?.status === 'passed' ? '全部组合符合目标，没有失败路径。' : '检测后可复现失败输入，沿错误输出向上游排查。高亮只表示候选范围，不会直接认定某个门有错。'}</p>`;
    return;
  }
  const firstText = Object.entries(first.labels).map(([name, value]) => `${name}=${value}`).join('，');
  const summary = `<p>首个失败：<b>${esc(firstText)}</b></p><p>${first.failures.map(f => `${esc(f.label)} 期望 ${f.expected} / 实际 ${bit(f.actual)}`).join('；')}</p>`;
  const row = goalResult.rows[traceIndex];
  if (!row || row.pass || !inputsOf(editor.circuit).every(n => row.assignment[n.id] === n.value)) {
    traceIndex = null; setHighlight([]);
    target.innerHTML = summary + '<p class="micro">点击「复现首个失败」或失败行，把反例输入带回工作台并高亮上游候选路径。</p>';
    return;
  }
  const trace = traceUpstream(editor.circuit, row.failures.map(f => f.id));
  setHighlight(trace.nodeIds);
  const nodes = new Map(editor.circuit.nodes.map(n => [n.id, n])), values = evaluate(editor.circuit, row.assignment).values;
  const pathText = trace.paths.map(path => `<li>${path.nodes.map(id => { const node = nodes.get(id); return `${esc(node?.label || id)}${node && !['INPUT','OUTPUT'].includes(node.type) ? ` [${esc(node.type)}]` : ''}=${bit(values.get(id))}`; }).join(' ← ')}${path.cycle ? '（反馈回路）' : ''}</li>`).join('');
  target.innerHTML = summary + `<p class="trace-heading">当前追踪：${esc(Object.entries(row.labels).map(([name, value]) => `${name}=${value}`).join('，'))} → ${row.failures.map(f => `${esc(f.label)} 期望 ${f.expected} / 实际 ${bit(f.actual)}`).join('；')}</p><ul class="trace-paths">${pathText}</ul>${trace.truncated ? '<p class="micro">路径较多，仅列前 24 条；画布已高亮全部上游候选元件。</p>' : ''}<p class="micro">箭头向左读取上游。高亮为候选范围：门类型、接线与端子均需检查，不是唯一错门结论。</p>`;
}

function runGoalCheck() {
  goalResult = checkGoal(editor.circuit, goalForCircuit(editor.circuit), evaluate);
  traceIndex = null; render(editor, false, 'check');
}
function reproduceGoalRow(index) {
  const row = goalResult?.rows[index];
  if (!row?.editorBits) return;
  traceIndex = row.pass ? null : index;
  editor.setInputs(row.editorBits);
}

function renderMap() {
  const inputs = inputsOf(editor.circuit), outputs = outputsOf(editor.circuit), index = outputs.findIndex(n => n.id === outputId);
  if (index < 0) {
    map = null; mapFocus = null;
    $('kmap').textContent = '添加输出后生成卡诺图。'; $('expression').textContent = '—';
    $('group-terms').innerHTML = ''; $('group-detail').textContent = ''; $('gray-note').textContent = '';
    return;
  }
  const names = inputs.map(n => n.label);
  map = kmapModel(table.map(row => row.outputs[index]), names, minimizeDetails);
  const { rowCount, rowCodes, colCodes, cells } = map;
  $('kmap').innerHTML = `<div class="kmap-caption">${esc(names.slice(0, rowCount).join(', ') || '—')} \\ ${esc(names.slice(rowCount).join(', ') || '—')}</div><table aria-label="输出 ${esc(outputs[index].label)} 的卡诺图"><thead><tr><th></th>${colCodes.map(code => `<th>${code || '—'}</th>`).join('')}</tr></thead><tbody>${rowCodes.map((code, r) => `<tr><th>${code || '—'}</th>${cells[r].map((cell, c) => {
    const value = table[cell].outputs[index];
    return `<td class="${value === 1 ? 'one' : ''}" data-map-cell="${cell}" data-r="${r}" data-c="${c}"><button data-cell="${cell}" aria-pressed="false" aria-label="输入 ${esc(names.map((name, i) => `${name}=${table[cell].bits[i]}`).join('，') || '无变量')}，输出 ${bit(value)}，查看覆盖圈组">${bit(value)}</button></td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
  $('expression').textContent = `${outputs[index].label} = ${map.expression}`;
  const axes = [[names.slice(0, rowCount), rowCodes, '行'], [names.slice(rowCount), colCodes, '列']].filter(([labels]) => labels.length);
  $('gray-note').textContent = axes.length ? axes.map(([labels, codes, title]) => `${title} ${labels.join(', ')}：${codes.join(' → ')}；首尾 ${codes[0]} ↔ ${codes.at(-1)} 也相邻。`).join(' ') + '相邻只差一位；圈组可跨左右 / 上下边界。' : '零变量：只有一个格子，没有需要保留或消去的输入变量。';
  $('group-terms').innerHTML = map.groups.map((group, i) => `<button class="group-term" data-group="${i}" aria-pressed="false" aria-label="圈 ${i + 1}，${esc(group.term)}，覆盖 ${group.covers.length} 格"><small>圈 ${i + 1}</small> ${esc(group.term)} <small>${group.covers.length} 格</small></button>`).join('');
  if (!mapFocus && map.groups.length) mapFocus = { type: 'group', index: 0 };
  updateMapSelection();
}
function updateMapSelection() {
  if (!map) return;
  const indices = map.groups.flatMap((group, i) => (mapFocus?.type === 'cell' ? group.covers.includes(mapFocus.index) : mapFocus?.index === i) ? [i] : []);
  const covers = new Set(indices.flatMap(i => map.groups[i].covers));
  for (const button of $('group-terms').querySelectorAll('[data-group]')) button.setAttribute('aria-pressed', String(indices.includes(Number(button.dataset.group))));
  for (const cell of $('kmap').querySelectorAll('[data-map-cell]')) {
    const index = Number(cell.dataset.mapCell), r = Number(cell.dataset.r), c = Number(cell.dataset.c), selected = covers.has(index);
    cell.classList.toggle('covered', selected);
    cell.classList.toggle('cell-picked', mapFocus?.type === 'cell' && mapFocus.index === index);
    for (const [side, nr, nc] of [['top', r - 1, c], ['bottom', r + 1, c], ['left', r, c - 1], ['right', r, c + 1]]) cell.classList.toggle(`edge-${side}`, selected && !covers.has(map.cells[nr]?.[nc]));
    cell.querySelector('button').setAttribute('aria-pressed', String(selected));
  }
  const detail = $('group-detail');
  if (map.unknown) { detail.textContent = '存在未定义信号（?），不进行圈组或化简。请先修复未接端口或反馈回路。'; return; }
  if (!map.groups.length) { detail.textContent = '输出恒为 0：没有值为 1 的格子，不需要圈组，表达式为 0。'; return; }
  if (!indices.length) { detail.textContent = '这个格子不在任何圈组内。圈组只覆盖值为 1 的格子。'; return; }
  detail.innerHTML = indices.map(i => {
    const group = map.groups[i], retained = group.retained.map(v => `${esc(v.name)}=${v.value}`).join('、'), eliminated = group.eliminated.map(esc).join('、');
    return `<div><b>圈 ${i + 1} → ${esc(group.term)}</b><p>保留：${retained || '无（常量 1）'}。</p><p>消去：${eliminated ? `${eliminated}（组内 0 / 1 都出现）` : '无'}。</p>${group.wrapsColumns || group.wrapsRows ? `<p class="wrap-note">跨${[group.wrapsColumns ? '左右' : '', group.wrapsRows ? '上下' : ''].filter(Boolean).join('和')}边界，首尾格也相邻。</p>` : ''}</div>`;
  }).join('');
}

$('truth-table').addEventListener('click', event => { const row = event.target.closest('[data-row]'); if (row) editor.setInputs(table[Number(row.dataset.row)].bits); });
$('output-select').addEventListener('change', event => { outputId = event.target.value; mapFocus = null; renderMap(); });
for (const eventName of ['click', 'focusin']) {
  $('group-terms').addEventListener(eventName, event => { const button = event.target.closest('[data-group]'); if (button) { mapFocus = { type: 'group', index: Number(button.dataset.group) }; updateMapSelection(); } });
  $('kmap').addEventListener(eventName, event => { const button = event.target.closest('[data-cell]'); if (button) { mapFocus = { type: 'cell', index: Number(button.dataset.cell) }; updateMapSelection(); } });
}
$('goal-select').addEventListener('change', event => {
  if (!Object.hasOwn(GOALS, event.target.value)) return;
  editor.load({ ...copy(editor.circuit), labGoal: event.target.value });
});
$('goal-check').addEventListener('click', runGoalCheck);
$('first-failure').addEventListener('click', () => { if (goalResult?.firstFailure) reproduceGoalRow(goalResult.firstFailure.index); });
$('goal-table').addEventListener('click', event => { const button = event.target.closest('[data-goal-row]'); if (button) reproduceGoalRow(Number(button.dataset.goalRow)); });
$('debug-exercise').addEventListener('click', () => {
  editor.load(makeDebugExercise(EXAMPLES.half)); runGoalCheck();
  reproduceGoalRow(goalResult.firstFailure.index);
  notify('已载入有意错误的半加器并复现反例；可撤销恢复之前的电路和目标。');
});
$('diagnostics').addEventListener('click', event => { const item = event.target.closest('[data-focus]'); if (item) editor.select(item.dataset.focus); });
$('example').addEventListener('change', event => {
  const example = EXAMPLES[event.target.value]; if (!example) return;
  editor.load({ ...copy(example), labGoal: event.target.value === 'blank' ? 'free' : event.target.value });
  notify('已载入实验及对应目标；可点击撤销恢复之前的电路。');
});
$('undo').addEventListener('click', () => editor.undo());
$('redo').addEventListener('click', () => editor.redo());
$('delete-node').addEventListener('click', () => editor.remove());
$('export').addEventListener('click', () => { download('logic-lab-circuit.json', JSON.stringify(editor.circuit, null, 2)); notify('电路 JSON 已导出，可通过「导入 JSON」恢复。'); });
$('csv').addEventListener('click', () => {
  const headers = [...inputsOf(editor.circuit), ...outputsOf(editor.circuit)].map(n => n.label);
  download('logic-lab-truth-table.csv', '\ufeff' + [headers, ...table.map(row => [...row.bits, ...row.outputs.map(bit)])].map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
});
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 100000) throw new Error('文件太大，请导入 100 KB 以内的电路 JSON。');
    const circuit = validate(JSON.parse(await file.text())); circuit.labGoal = goalForCircuit(circuit);
    editor.load(circuit); notify('导入成功；可以撤销返回之前的电路。');
  } catch (error) { notify(error instanceof SyntaxError ? '不是有效的 JSON 电路文件。暂不支持 .circ。' : error.message); }
  event.target.value = '';
});
$('guide-open').addEventListener('click', () => $('guide').showModal());
$('guide-close').addEventListener('click', () => $('guide').close());
render();
if (loadNotice) notify(loadNotice);
