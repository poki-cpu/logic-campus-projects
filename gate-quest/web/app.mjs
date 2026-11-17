import { TYPES, validate, copy, evaluate } from './shared/engine.mjs';
import { Editor, esc, bit, notify, gateIcon } from './shared/editor.mjs';
import { LEVELS, createCircuit, checkSolution, starsFor } from './levels.mjs';
import { createProgress } from './progress.mjs';

const $ = id => document.getElementById(id);
let index = 0, editor, record, result = null, hintOpen = false, lastCircuit = '', storageAvailable = true;
const store = createProgress({
  levels: LEVELS,
  storage: () => window.localStorage,
  validateDraft(id, draft) {
    const valid = validate(draft), level = LEVELS.find(level => level.id === id);
    if (!checkSolution(level, valid).rows.length) throw new Error('无效关卡草稿。');
    return valid;
  },
  onError() {
    storageAvailable = false;
    $('storage-status').textContent = '本机存储受限 · 部分进度仅本页保留';
    notify('本机存档无法完整读写，部分进度仅在本页保留；请勿依赖关闭后恢复。');
  },
});
const starsText = count => '★'.repeat(count) + '☆'.repeat(3 - count);
const topology = circuit => JSON.stringify({
  nodes: circuit.nodes.map(({ x, y, value, ...node }) => node), wires: circuit.wires,
});
function renderJourney() {
  const progress = Object.fromEntries(LEVELS.map(level => [level.id, store.getStars(level.id)]));
  const complete = LEVELS.filter(level => progress[level.id]).length;
  $('progress-number').textContent = `${String(complete).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}`;
  $('progress-bar').style.width = `${complete / LEVELS.length * 100}%`;
  $('total-stars').textContent = `${Object.values(progress).reduce((a, b) => a + b, 0)} / ${LEVELS.length * 3} 星`;
  $('level-best').textContent = progress[LEVELS[index].id] ? starsText(progress[LEVELS[index].id]) : '';
  let chapter = '';
  $('levels').innerHTML = LEVELS.map((level, i) => {
    const title = chapter !== level.chapter ? `<div class="chapter-label">${esc(level.chapter)}</div>` : '';
    chapter = level.chapter;
    const label = `第 ${i + 1} 关 ${level.title}${progress[level.id] ? ' 已获 ' + progress[level.id] + ' 星' : ''}`;
    return title + `<button class="level-button ${i === index ? 'active' : ''} ${progress[level.id] ? 'completed' : ''}" data-level="${i}" ${i === index ? 'aria-current="step"' : ''} aria-label="${esc(label)}"><span class="level-index">${progress[level.id] ? '✓' : String(i + 1).padStart(2, '0')}</span><span><strong>${esc(level.title)}</strong><small>${progress[level.id] ? starsText(progress[level.id]) : '未完成'}</small></span><span class="level-arrow">↗</span></button>`;
  }).join('');
}
function emptyFeedback() {
  $('feedback').className = 'feedback';
  $('feedback').innerHTML = '<div class="feedback-heading"><span class="eyebrow">SIGNAL CHECK</span><span>穷举所有输入，不只检测当前开关</span></div><p>连接电路后运行检测，看看你的信号能否到达终点。</p>';
}
function invalidateFeedback(message = '电路已改变 · 等待检测') {
  result = null; emptyFeedback(); $('board-state').textContent = message;
}

const hintLabels = ['规律', '思路', '接法'];
function renderHints() {
  const level = LEVELS[index], seen = record.hintsSeen;
  $('hint').textContent = hintOpen ? '收起提示 ↗' : seen ? `查看已读提示（${seen}/3）↗` : '查看第 1 级提示 · 本次失去无提示星 ↗';
  $('hint').setAttribute('aria-expanded', String(hintOpen));
  $('hint-panel').hidden = !hintOpen;
  $('hint-panel').innerHTML = `<b>逐级灵感 · 已查看 ${seen}/3</b><ol class="hint-steps">${level.hints.slice(0, seen).map((text, i) => `<li><span>${i + 1} / ${esc(hintLabels[i])}</span><p>${esc(text)}</p></li>`).join('')}</ol>${seen < level.hints.length ? `<button class="hint-next" data-hint-next>查看第 ${seen + 1} 级 · ${esc(hintLabels[seen])} →</button>` : '<p class="hint-complete">三级提示已全部展开。</p>'}<small>首次查看即失去本次挑战的“无提示”星；收起或撤销不会恢复。仍可获得通关与精简星。重置将清空电路、撤销/重做及提示记录，最高星保留。</small>`;
}

const sceneTitles = {
  'first-light': '海港灯塔', opposite: '暮色街灯', 'two-keys': '双钥闸门', backup: '双路能源站',
  different: '共鸣水晶广场', universal: '碎片中继站', 'half-adder': '和与进位双塔', selector: '城市路由中枢',
};
const signalClass = value => value === 1 ? 'live' : value === 0 ? 'off' : 'unknown';
const svgText = (x, y, text, extra = '') => `<text x="${x}" y="${y}" class="scene-text ${extra}">${esc(text)}</text>`;
const signalLine = (path, value, extra = '') => `<path d="${path}" class="scene-line ${signalClass(value)} ${extra}"/>`;
function source(x, y, label, value) {
  return `<g class="scene-device ${signalClass(value)}"><rect x="${x}" y="${y}" width="66" height="37" rx="7"/><circle cx="${x + 13}" cy="${y + 18}" r="4" class="scene-lamp"/>${svgText(x + 41, y + 23, `${label} ${bit(value)}`)}</g>`;
}
function beacon(x, value, label, style = '') {
  return `<g class="scene-device scene-beacon ${signalClass(value)} ${style}" transform="translate(${x} 0)"><path d="M-14 143 L-8 79 H8 L14 143 Z" class="scene-building"/><path d="M-24 83 L0 62 L24 83 Z" class="scene-building"/><path d="M-13 78 L-75 55 V108 L-13 91 M13 78 L75 55 V108 L13 91" class="scene-beam"/><rect x="-12" y="82" width="24" height="15" rx="2" class="scene-lamp"/><path d="M-8 112 H8 M-10 127 H10" class="scene-detail"/>${svgText(0, 164, `${label} ${bit(value)}`)}</g>`;
}
function sceneDrawing(level, inputs, actual) {
  const [a, b, s] = inputs, [y, carry] = actual;
  switch (level.id) {
    case 'first-light':
      return `${source(36, 102, 'A', a)}${signalLine('M102 121 H240 V143 H307', a)}<path d="M270 177 Q290 169 310 177 T350 177 T390 177 T430 177" class="scene-water"/>${beacon(340, y, '灯塔 Y')}`;
    case 'opposite':
      return `<g class="scene-device ${signalClass(a)}"><circle cx="90" cy="67" r="19" class="scene-lamp"/>${svgText(90, 37, a ? '白昼' : '夜幕')}</g>${source(57, 113, 'A', a)}${signalLine('M123 131 H259', a)}<g class="scene-device ${signalClass(y)}"><path d="M300 146 V65 Q300 51 316 51 H350" class="scene-detail"/><path d="M337 63 L302 147 H400 L364 63" class="scene-beam"/><path d="M333 51 H369 L363 63 H339 Z" class="scene-lamp"/>${svgText(351, 167, `夜灯 Y ${bit(y)}`)}</g>`;
    case 'two-keys':
      return `${source(34, 53, '钥匙 A', a)}${source(34, 110, '钥匙 B', b)}${signalLine('M100 72 H203 V97 H245', a)}${signalLine('M100 129 H218 V112 H245', b)}<g class="scene-device scene-gate ${signalClass(y)}"><path d="M250 149 V57 H390 V149" class="scene-detail"/><rect x="265" y="69" width="110" height="76" rx="3" class="scene-shutter"/><path d="M270 84 H370 M270 103 H370 M270 122 H370" class="scene-shutter-lines"/>${svgText(320, 171, y === 1 ? '闸门 Y · 已升起' : y === 0 ? '闸门 Y · 已关闭' : '闸门 Y · 信号未知')}</g>`;
    case 'backup':
      return `${source(32, 45, '电源 A', a)}${source(32, 111, '电源 B', b)}${signalLine('M98 64 H175 V105 H261', a)}${signalLine('M98 130 H175 V105', b)}<g class="scene-device ${signalClass(y)}"><rect x="265" y="57" width="126" height="88" rx="8" class="scene-building"/><path d="M274 80 H383 M274 103 H383 M274 126 H383" class="scene-energy"/>${svgText(328, 168, `街区供电 Y ${bit(y)}`)}</g>`;
    case 'different':
      return `${source(27, 84, 'A', a)}${source(385, 84, 'B', b)}${signalLine('M93 103 H191', a)}${signalLine('M385 103 H281', b)}<g class="scene-device scene-crystal ${signalClass(y)}"><path d="M236 42 L278 92 L260 137 H212 L194 92 Z" class="scene-lamp"/><path d="M236 42 V137 M194 92 H278 M212 137 L236 92 L260 137" class="scene-detail"/><ellipse cx="236" cy="148" rx="61" ry="8" class="scene-halo"/>${svgText(236, 174, `共鸣 Y ${bit(y)}`)}</g>`;
    case 'universal':
      return `${source(24, 44, 'A', a)}${source(24, 111, 'B', b)}${signalLine('M90 63 H133 V84 H168', a)}${signalLine('M90 130 H146 V105 H168', b)}<g class="scene-relay"><rect x="172" y="64" width="106" height="65" rx="8"/><path d="M184 96 H207 L217 80 L232 111 L242 96 H266"/>${svgText(225, 151, '仅限 NAND 碎片')}</g>${signalLine('M278 96 H306', y)}${beacon(377, y, '中继 Y')}`;
    case 'half-adder':
      return `${source(19, 49, 'A', a)}${source(19, 107, 'B', b)}${signalLine('M85 68 H142 V89 H171', a)}${signalLine('M85 126 H155 V103 H171', b)}<g class="scene-relay"><rect x="173" y="76" width="47" height="40" rx="7"/>${svgText(197, 103, '+', 'scene-plus')}</g>${signalLine('M220 86 H250 V117 H275', y)}${signalLine('M220 105 H239 V144 H402', carry)}${beacon(294, y, '和 S')}${beacon(415, carry, '进位 C')}${svgText(293, 30, `${bit(a)} + ${bit(b)} → C S = ${bit(carry)}${bit(y)}（二进制）`)}`;
    case 'selector': {
      const choice = s === 0 ? 'A' : 'B';
      return `${source(24, 41, 'A', a)}${source(24, 115, 'B', b)}${signalLine('M90 60 H176 L243 95', a, s === 0 ? 'route-selected' : 'route-muted')}${signalLine('M90 134 H176 L243 99', b, s === 1 ? 'route-selected' : 'route-muted')}<g class="scene-router"><circle cx="253" cy="97" r="26"/>${svgText(253, 103, `选 ${choice}`)}</g>${source(217, 147, 'S', s)}${signalLine('M250 147 V123', s)}${signalLine('M279 97 H343', y)}<g class="scene-device ${signalClass(y)}"><rect x="348" y="60" width="100" height="75" rx="9" class="scene-building"/><circle cx="398" cy="90" r="13" class="scene-lamp"/>${svgText(398, 121, `Y ${bit(y)}`)}</g>${svgText(395, 159, `当前路由 ${choice} → Y`)}`;
    }
    default: return '';
  }
}
function renderScene() {
  const level = LEVELS[index], { values } = evaluate(editor.circuit);
  const inputs = level.inputs.map((_, i) => values.get(`in${i}`));
  const actual = level.outputs.map((_, i) => values.get(`out${i}`));
  const expected = level.rule(inputs);
  const unknown = actual.some(value => value !== 0 && value !== 1);
  const matched = !unknown && actual.every((value, i) => value === expected[i]);
  const status = unknown ? '未知 · 检查连接' : matched ? '当前组合一致' : '当前组合不一致';
  $('district').dataset.state = unknown ? 'unknown' : matched ? 'match' : 'mismatch';
  $('scene-title').textContent = `街区修复 / ${sceneTitles[level.id]}`;
  $('scene-status').textContent = status;
  $('scene-target').textContent = level.target;
  $('scene-inputs').textContent = `实时输入：${level.inputs.map((name, i) => `${name}=${bit(inputs[i])}`).join(' · ')}`;
  $('scene-readings').innerHTML = level.outputs.map((name, i) => {
    const state = actual[i] === null || actual[i] === undefined ? '未知' : actual[i] === expected[i] ? '一致' : '不一致';
    const label = level.id === 'half-adder' ? `${name}（${i === 0 ? '和' : '进位'}）` : name;
    return `<div class="scene-reading ${signalClass(actual[i])}"><b>${esc(label)}</b><span>目标 <strong>${esc(expected[i])}</strong></span><span>实际 <strong>${esc(bit(actual[i]))}</strong></span><small>${esc(state)}</small></div>`;
  }).join('');
  $('district-art').innerHTML = `<title>${esc(sceneTitles[level.id])}：${esc(status)}</title><path d="M0 150 H480 M12 149 V131 H44 V149 M432 149 V118 H466 V149" class="scene-skyline"/>${sceneDrawing(level, inputs, actual)}`;
}
function renderEditorState() {
  const level = LEVELS[index];
  const gates = editor.circuit.nodes.filter(node => !['INPUT', 'OUTPUT'].includes(node.type)).length;
  $('gate-count').textContent = `元件 ${gates} / ${level.maxGates}`;
  $('undo').disabled = !editor.history.length;
  $('redo').disabled = !editor.future.length;
  $('delete').disabled = !editor.selected || editor.options.fixed.includes(editor.selected);
  $('board-caption').textContent = editor.pending ? '正在连线 · 点击下游输入端口，或按 Esc 取消' : '点击右侧输出圆点 → 点击左侧输入圆点';
  renderScene();
}
function replaceCircuit(circuit) {
  // Deliberately avoid Editor.load(): reset/load must not create an undo entry.
  editor.circuit = copy(circuit); editor.selected = null; editor.pending = null;
  editor.drag = null; editor.ignoreClick = false; editor.history = []; editor.future = [];
  editor.render(); lastCircuit = JSON.stringify(editor.circuit);
}
function applyRemote(next, announce = false) {
  const circuit = next.draft || createCircuit(LEVELS[index]);
  const challengeChanged = next.challenge !== record.challenge;
  const changed = JSON.stringify(circuit) !== JSON.stringify(editor.circuit);
  if (challengeChanged || changed) {
    if (challengeChanged || topology(circuit) !== topology(editor.circuit)) invalidateFeedback('其他页面已更新电路 · 等待检测');
    replaceCircuit(circuit);
    if ($('success').open) $('success').close();
  }
  if (challengeChanged) hintOpen = false;
  record = next; renderHints(); renderEditorState();
  if (announce) notify('已同步其他页面的本关进度。为避免覆盖，旧页草稿未写入；请在最新电路上继续。');
}
function syncCurrent() {
  if (editor.drag) return;
  const next = store.getLevel(LEVELS[index].id);
  if (next.revision !== record.revision) applyRemote(next);
  renderJourney();
}
function onChange(sourceEditor, edited = true, kind = edited ? 'topology' : 'selection') {
  if (edited && kind === 'topology') invalidateFeedback();
  if (['topology', 'input', 'layout'].includes(kind) && JSON.stringify(sourceEditor.circuit) !== lastCircuit) {
    const saved = store.saveDraft(LEVELS[index].id, sourceEditor.circuit, record.revision);
    if (saved.conflict) { applyRemote(saved.record, true); renderJourney(); return; }
    record = saved.record; lastCircuit = JSON.stringify(sourceEditor.circuit);
  }
  renderEditorState();
}
function loadLevel(i, remember = true) {
  if (!Number.isInteger(i) || !LEVELS[i]) return;
  index = i; result = null; hintOpen = false;
  const level = LEVELS[index]; record = store.getLevel(level.id);
  const options = { onChange, allowed: level.allowed, maxGates: level.maxGates, fixed: createCircuit(level).nodes.map(node => node.id) };
  if (!editor) editor = new Editor($('board'), record.draft || createCircuit(level), options);
  else editor.options = { ...editor.options, ...options };
  replaceCircuit(record.draft || createCircuit(level));
  const chapters = [...new Set(LEVELS.map(level => level.chapter))];
  $('chapter').textContent = `CHAPTER ${String(chapters.indexOf(level.chapter) + 1).padStart(2, '0')} / ${level.chapter}`;
  $('level-number').textContent = `LEVEL ${String(index + 1).padStart(2, '0')} OF ${String(LEVELS.length).padStart(2, '0')}`;
  $('level-title').textContent = level.title; $('level-subtitle').textContent = level.subtitle;
  $('mission-text').textContent = level.mission;
  $('test-note').textContent = `${2 ** level.inputs.length} 组输入 · 目标 ${level.par} 个门`;
  $('inventory').innerHTML = level.allowed.length ? level.allowed.map(type => `<button class="gate-piece" data-gate="${esc(type)}" aria-label="${esc('添加' + TYPES[type].label)}">${gateIcon(type)}<span class="piece-name">${esc(TYPES[type].label)}<small>${esc(type)}</small></span></button>`).join('') : '<span class="inventory-empty">本关无需逻辑门。用一根导线，唤醒第一束光。</span>';
  invalidateFeedback('等待接通信号'); renderHints(); renderJourney(); renderEditorState();
  if (remember) store.select(level.id);
}
function revealNextHint() {
  syncCurrent();
  const saved = store.revealHint(LEVELS[index].id, record.hintsSeen + 1, record.revision);
  if (saved.conflict) { applyRemote(saved.record, true); return; }
  record = saved.record; hintOpen = true; renderHints();
}
$('levels').addEventListener('click', event => { const button = event.target.closest('[data-level]'); if (button) loadLevel(Number(button.dataset.level)); });
$('inventory').addEventListener('click', event => { const button = event.target.closest('[data-gate]'); if (button) editor.add(button.dataset.gate); });
$('undo').addEventListener('click', () => editor.undo());
$('redo').addEventListener('click', () => editor.redo());
$('delete').addEventListener('click', () => editor.remove());
$('reset').addEventListener('click', () => {
  record = store.reset(LEVELS[index].id, createCircuit(LEVELS[index])).record;
  hintOpen = false; replaceCircuit(record.draft); invalidateFeedback('新挑战 · 等待接通信号');
  renderHints(); renderJourney(); renderEditorState();
  notify('已开始新挑战：电路、撤销/重做和提示记录已清空，历史最高星保留。');
});
$('hint').addEventListener('click', () => {
  syncCurrent();
  if (!record.hintsSeen) { revealNextHint(); return; }
  hintOpen = !hintOpen; renderHints();
});
$('hint-panel').addEventListener('click', event => { if (event.target.closest('[data-hint-next]')) revealNextHint(); });
$('run').addEventListener('click', () => {
  syncCurrent();
  const level = LEVELS[index]; result = checkSolution(level, editor.circuit);
  const passed = result.rows.filter(row => row.pass).length;
  $('feedback').className = 'feedback ' + (result.passed ? 'pass' : 'fail');
  $('feedback').innerHTML = `<div class="feedback-heading"><span class="eyebrow">${result.passed ? 'ALL SIGNALS CLEAR' : 'SIGNAL MISMATCH'}</span><span>${passed} / ${result.rows.length} 组输入通过</span></div><p>${result.passed ? '所有输入组合都符合目标。你的电路经得起每一种可能。' : esc(result.error || '还有一些信号没有到达正确的位置。已在画布复现第一组反例，点击下方测试也可复现。')}</p><div class="test-results">${result.rows.map((row, i) => `<button class="test-result ${row.pass ? 'ok' : 'bad'}" data-test="${i}" aria-label="${esc('复现测试 ' + row.bits.join(' '))}">${row.pass ? '✓' : '×'} ${esc(row.bits.join(''))} → ${esc(row.outputs.map(bit).join(''))}${row.pass ? '' : `（目标 ${esc(row.expected.join(''))}）`}</button>`).join('')}</div>`;
  $('board-state').textContent = result.passed ? '信号接通 · 全部测试通过' : '检测未通过 · 查看下方反例';
  if (!result.passed) {
    const mismatch = result.rows.find(row => !row.pass);
    if (mismatch) editor.setInputs(mismatch.bits);
    return;
  }
  const stars = starsFor(level, result.gates, record.hintsSeen > 0);
  store.award(level.id, stars); renderJourney();
  $('earned-stars').textContent = starsText(stars);
  const finalLevel = index === LEVELS.length - 1;
  $('success-title').textContent = finalLevel ? '路由归位，街区重启。' : '信号，接通了。';
  $('success-description').textContent = `「${level.title}」完成。${finalLevel ? '你已接通最后的信号路由中枢。' : ''}${stars === 3 ? '精简的电路，独立的思考。三颗星属于你。' : '再优化一下电路，或重置后独立完成，挑战三颗星。'}`;
  $('success-stats').innerHTML = `<span><b>${result.rows.length}/${result.rows.length}</b>测试通过</span><span><b>${result.gates}/${level.par}</b>使用 / 目标门数</span><span><b>${record.hintsSeen}/3</b>已查看提示</span>`;
  $('concept').textContent = level.concept;
  $('next').innerHTML = finalLevel ? '回到第一关 <span>↻</span>' : '下一关 <span>→</span>';
  $('success').showModal();
});
$('feedback').addEventListener('click', event => {
  const test = event.target.closest('[data-test]'), row = result?.rows[Number(test?.dataset.test)];
  if (test && row) editor.setInputs(row.bits);
});
$('next').addEventListener('click', () => { $('success').close(); loadLevel((index + 1) % LEVELS.length); });
$('replay').addEventListener('click', () => $('success').close());
$('success-close').addEventListener('click', () => $('success').close());
$('help-open').addEventListener('click', () => $('help').showModal());
$('help-close').addEventListener('click', () => $('help').close());
window.addEventListener('storage', event => { if (store.isStorageKey(event.key)) syncCurrent(); });
window.addEventListener('focus', syncCurrent);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncCurrent(); });
// A remote update during a drag is applied after pointer handling, not mid-gesture.
$('board').addEventListener('pointerup', () => queueMicrotask(syncCurrent));
$('board').addEventListener('pointercancel', () => queueMicrotask(syncCurrent));
$('help-level-count').textContent = String(LEVELS.length);
loadLevel(LEVELS.findIndex(level => level.id === store.getSelection()), false);
if (storageAvailable) $('storage-status').textContent = '进度保存在这台设备';
