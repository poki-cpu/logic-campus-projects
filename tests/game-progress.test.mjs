import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgress, LEGACY_KEY, PROGRESS_PREFIX } from '../gate-quest/web/progress.mjs';
import { LEVELS, createCircuit, checkSolution, starsFor } from '../gate-quest/web/levels.mjs';
import { validate, copy } from '../gate-quest/web/shared/engine.mjs';
import { Editor, notify } from '../gate-quest/web/shared/editor.mjs';

class Storage {
  data = new Map(); writes = [];
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.writes.push([key, value]); this.data.set(key, String(value)); }
}
const byId = id => LEVELS.find(level => level.id === id);
const blank = id => createCircuit(byId(id));
const solvedLight = () => ({ ...blank('first-light'), wires: [{ from: 'in0', to: 'out0', port: 0 }] });
const levelKey = id => `${PROGRESS_PREFIX}level:${id}`;
function page(storage, onError = () => {}) {
  return createProgress({ levels: LEVELS, storage, onError, validateDraft(id, draft) {
    validate(draft);
    if (!checkSolution(byId(id), draft).rows.length) throw new Error('Wrong level');
    return draft;
  } });
}
function edit(store, id, draft) { return store.saveDraft(id, draft, store.getLevel(id).revision); }

test('level IDs and rules remain compatible, with half-adder before final selector', () => {
  assert.deepEqual(LEVELS.map(level => level.id), ['first-light', 'opposite', 'two-keys', 'backup', 'different', 'universal', 'half-adder', 'selector']);
  assert.deepEqual(LEVELS.map(level => level.chapter), ['唤醒', '唤醒', '联结', '联结', '共鸣', '共鸣', '重启', '重启']);
  assert.deepEqual(byId('half-adder').rule([1, 1]), [0, 1]);
  assert.deepEqual(byId('selector').rule([0, 1, 1]), [1]);
  assert.equal(byId('selector').par, 4);
  for (const level of LEVELS) {
    assert.equal(level.hints.length, 3);
    assert.ok(level.hints.every(hint => typeof hint === 'string' && hint.length));
    assert.equal(starsFor(level, level.par, true), 2);
  }
});

test('v1 migration is lazy, preserves scores/drafts, and maps old index by ID', () => {
  const storage = new Storage();
  const legacy = JSON.stringify({ index: 6, progress: { selector: 3, 'half-adder': 2 }, drafts: { selector: blank('selector') }, usedHints: { selector: true } });
  storage.data.set(LEGACY_KEY, legacy);
  const store = page(storage);
  assert.equal(store.getSelection(), 'selector');
  assert.equal(store.getStars('selector'), 3);
  assert.equal(store.getStars('half-adder'), 2);
  assert.deepEqual(store.getLevel('selector').draft, blank('selector'));
  assert.equal(store.getLevel('selector').hintsSeen, 3);
  assert.equal(storage.writes.length, 0);
  storage.data.set(LEGACY_KEY, JSON.stringify({ index: 7 }));
  assert.equal(store.getSelection(), 'half-adder');
});

test('an old page switching levels cannot overwrite new stars or unedited drafts', () => {
  const storage = new Storage(), oldPage = page(storage), newPage = page(storage);
  oldPage.getLevel('first-light'); oldPage.getLevel('opposite');
  edit(newPage, 'first-light', solvedLight());
  const otherDraft = blank('opposite'); otherDraft.nodes[0].x = 130;
  edit(newPage, 'opposite', otherDraft); newPage.award('first-light', 3);
  const before = storage.writes.length;
  oldPage.select('opposite'); oldPage.select('first-light');
  assert.deepEqual(storage.writes.slice(before).map(([key]) => key), [`${PROGRESS_PREFIX}selected`, `${PROGRESS_PREFIX}selected`]);
  assert.deepEqual(oldPage.getLevel('first-light').draft, solvedLight());
  assert.deepEqual(oldPage.getLevel('opposite').draft, otherDraft);
  assert.equal(oldPage.getStars('first-light'), 3);
});

test('different-level writes never replace each other', () => {
  const storage = new Storage(), a = page(storage), b = page(storage);
  const stale = a.getLevel('first-light');
  edit(b, 'opposite', blank('opposite'));
  a.saveDraft('first-light', solvedLight(), stale.revision);
  assert.deepEqual(b.getLevel('first-light').draft, solvedLight());
  assert.deepEqual(a.getLevel('opposite').draft, blank('opposite'));
});

test('a stale draft revision detects a known conflict without overwriting', () => {
  const storage = new Storage(), a = page(storage), b = page(storage);
  const stale = a.getLevel('first-light');
  const fresh = edit(b, 'first-light', solvedLight()).record;
  const count = storage.writes.length;
  const result = a.saveDraft('first-light', blank('first-light'), stale.revision);
  assert.equal(result.conflict, true);
  assert.equal(result.record.revision, fresh.revision);
  assert.equal(storage.writes.length, count);
});

test('lower awards cannot erase highest stars, including interleaved writers', () => {
  const storage = new Storage(), a = page(storage), b = page(storage);
  const set = storage.setItem.bind(storage);
  let interleaved = false;
  storage.setItem = (key, value) => {
    if (key === `${PROGRESS_PREFIX}star:first-light:2` && !interleaved) {
      interleaved = true; b.award('first-light', 3);
    }
    set(key, value);
  };
  a.award('first-light', 2);
  assert.equal(page(storage).getStars('first-light'), 3);
  a.award('first-light', 1);
  assert.equal(page(storage).getStars('first-light'), 3);
});

test('legacy best survives lower awards and the v1 document is never rewritten', () => {
  const storage = new Storage(), old = JSON.stringify({ progress: { 'first-light': 3, opposite: 2 }, drafts: { opposite: blank('opposite') } });
  storage.data.set(LEGACY_KEY, old);
  const store = page(storage);
  store.award('first-light', 1); edit(store, 'first-light', solvedLight());
  assert.equal(storage.getItem(LEGACY_KEY), old);
  assert.equal(store.getStars('first-light'), 3);
  assert.equal(store.getStars('opposite'), 2);
  assert.deepEqual(store.getLevel('opposite').draft, blank('opposite'));
});

test('hints advance one step at a time and persist independently of topology edits', () => {
  const storage = new Storage(), store = page(storage);
  let state = store.getLevel('first-light');
  state = store.revealHint('first-light', 3, state.revision).record;
  assert.equal(state.hintsSeen, 0);
  for (let step = 1; step <= 3; step++) {
    state = store.revealHint('first-light', step, state.revision).record;
    assert.equal(state.hintsSeen, step);
  }
  edit(store, 'first-light', solvedLight());
  assert.equal(page(storage).getLevel('first-light').hintsSeen, 3);
  assert.equal(starsFor(byId('first-light'), 0, state.hintsSeen > 0), 2);
});

test('another page hint reveal prevents stale draft from clearing its hint state', () => {
  const storage = new Storage(), a = page(storage), b = page(storage);
  const stale = a.getLevel('first-light');
  b.revealHint('first-light', 1, stale.revision);
  assert.equal(a.saveDraft('first-light', solvedLight(), stale.revision).conflict, true);
  edit(a, 'first-light', solvedLight());
  assert.equal(b.getLevel('first-light').hintsSeen, 1);
});

test('reset starts a new challenge, clears hints, preserves all best scores', () => {
  const storage = new Storage(), store = page(storage);
  let old = edit(store, 'first-light', solvedLight()).record;
  old = store.revealHint('first-light', 1, old.revision).record;
  store.award('first-light', 3); store.award('opposite', 2);
  const reset = store.reset('first-light', blank('first-light')).record;
  assert.notEqual(reset.challenge, old.challenge);
  assert.equal(reset.hintsSeen, 0);
  assert.deepEqual(reset.draft, blank('first-light'));
  assert.equal(store.getStars('first-light'), 3);
  assert.equal(store.getStars('opposite'), 2);
  assert.equal(store.saveDraft('first-light', solvedLight(), old.revision).conflict, true);
});

test('unchanged drafts and reads perform no writes; returned records are detached', () => {
  const storage = new Storage(), store = page(storage);
  edit(store, 'first-light', solvedLight());
  const before = storage.writes.length, state = store.getLevel('first-light');
  store.saveDraft('first-light', state.draft, state.revision);
  assert.equal(storage.writes.length, before);
  state.draft.wires.length = 0;
  assert.equal(store.getLevel('first-light').draft.wires.length, 1);
});

test('invalid JSON is isolated and valid legacy scores remain readable', () => {
  const storage = new Storage(), errors = [];
  storage.data.set(LEGACY_KEY, JSON.stringify({ progress: { 'first-light': 3 } }));
  storage.data.set(levelKey('opposite'), '{broken');
  const store = page(storage, error => errors.push(error));
  assert.equal(store.getLevel('opposite').draft, null);
  assert.equal(store.getStars('first-light'), 3);
  assert.equal(store.getLevel('opposite').draft, null);
  assert.equal(errors.length, 1);
  storage.data.set(LEGACY_KEY, 'null');
  assert.equal(store.getSelection(), 'first-light');
});

test('invalid legacy drafts and noninteger score/hint data are not accepted', () => {
  const storage = new Storage();
  storage.data.set(LEGACY_KEY, JSON.stringify({ index: 100, progress: { 'first-light': 99, opposite: '3' }, drafts: { 'first-light': { nodes: [], wires: [] } }, usedHints: { 'first-light': 'true' } }));
  const store = page(storage);
  assert.equal(store.getLevel('first-light').draft, null);
  assert.equal(store.getLevel('first-light').hintsSeen, 0);
  assert.equal(store.getStars('first-light'), 0);
  assert.equal(store.getStars('opposite'), 0);
  assert.equal(store.getSelection(), 'first-light');
  assert.throws(() => store.select('__proto__'));
});

test('localStorage getter failure degrades to session memory and reports once', () => {
  const errors = [], store = page(() => { throw new Error('SecurityError'); }, error => errors.push(error));
  assert.equal(store.getSelection(), 'first-light');
  edit(store, 'first-light', solvedLight());
  store.award('first-light', 3); store.select('opposite');
  assert.deepEqual(store.getLevel('first-light').draft, solvedLight());
  assert.equal(store.getStars('first-light'), 3);
  assert.equal(store.getSelection(), 'opposite');
  assert.equal(errors.length, 1);
});

test('quota errors retain changed draft and hint records for this page only', () => {
  const storage = new Storage(), errors = [];
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const store = page(storage, error => errors.push(error));
  const saved = edit(store, 'first-light', solvedLight());
  assert.equal(saved.saved, false);
  store.revealHint('first-light', 1, saved.record.revision);
  assert.equal(store.getLevel('first-light').hintsSeen, 1);
  assert.deepEqual(store.getLevel('first-light').draft, solvedLight());
  assert.equal(page(storage).getLevel('first-light').draft, null);
  assert.equal(errors.length, 1);
});

test('storage events can identify all progress keys without reacting to unrelated apps', () => {
  const store = page(new Storage());
  for (const key of [null, LEGACY_KEY, levelKey('first-light'), `${PROGRESS_PREFIX}star:first-light:3`]) assert.equal(store.isStorageKey(key), true);
  assert.equal(store.isStorageKey('logic-lab:settings'), false);
});

function solution(level) {
  const circuit = createCircuit(level);
  const add = type => {
    const id = `gate${circuit.nodes.length}`;
    circuit.nodes.push({ id, type, label: type, x: 250, y: 100 });
    return id;
  };
  const wire = (from, to, port = 0) => circuit.wires.push({ from, to, port });
  const pair = gate => { wire('in0', gate); wire('in1', gate, 1); };
  if (level.id === 'first-light') wire('in0', 'out0');
  else if (level.id === 'opposite') { const g = add('NOT'); wire('in0', g); wire(g, 'out0'); }
  else if (['two-keys', 'backup', 'different'].includes(level.id)) {
    const g = add({ 'two-keys': 'AND', backup: 'OR', different: 'XOR' }[level.id]); pair(g); wire(g, 'out0');
  } else if (level.id === 'universal') {
    const a = add('NAND'), b = add('NAND'); pair(a); wire(a, b); wire(a, b, 1); wire(b, 'out0');
  } else if (level.id === 'half-adder') {
    const s = add('XOR'), c = add('AND'); pair(s); pair(c); wire(s, 'out0'); wire(c, 'out1');
  } else if (level.id === 'selector') {
    const n = add('NOT'), a = add('AND'), b = add('AND'), o = add('OR');
    wire('in2', n); wire('in0', a); wire(n, a, 1); wire('in1', b); wire('in2', b, 1);
    wire(a, o); wire(b, o, 1); wire(o, 'out0');
  }
  return circuit;
}

test('app integration: read-only selection, feedback, hint/reset history, live scenes and storage sync', async t => {
  const storage = new Storage(), elements = new Map();
  const oldWindow = globalThis.window, oldDocument = globalThis.document, originalRender = Editor.prototype.render;
  let editor;
  const eventTarget = () => ({
    handlers: new Map(),
    addEventListener(type, handler) {
      if (!this.handlers.has(type)) this.handlers.set(type, []);
      this.handlers.get(type).push(handler);
    },
    emit(type, target = { closest: () => null }, extra = {}) {
      for (const handler of this.handlers.get(type) || []) handler({ target, ...extra });
    },
  });
  const doc = { ...eventTarget(), activeElement: null, hidden: false, getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      ...eventTarget(), innerHTML: '', textContent: '', style: {}, dataset: {}, disabled: false, hidden: false, open: false,
      classList: { add() {}, remove() {} }, ownerDocument: doc,
      setAttribute() {}, contains() { return false; }, showModal() { this.open = true; }, close() { this.open = false; },
      click() { this.emit('click'); },
    });
    return elements.get(id);
  } };
  const win = { ...eventTarget(), localStorage: storage };
  globalThis.window = win; globalThis.document = doc;
  Editor.prototype.render = function () { editor = this; return originalRender.call(this); };
  const $ = id => doc.getElementById(id);
  const select = index => $('levels').emit('click', { closest: () => ({ dataset: { level: String(index) } }) });
  try {
    await import('../gate-quest/web/app.mjs?game-progress-integration');
    await t.test('loading and selecting nodes/levels do not save drafts', () => {
      assert.equal(storage.writes.length, 0);
      editor.select('in0');
      assert.equal(storage.writes.length, 0);
      select(1); select(0);
      assert.ok(storage.writes.every(([key]) => key === `${PROGRESS_PREFIX}selected`));
    });
    await t.test('manual input, layout, replay and their undo keep counterexamples', () => {
      $('run').click();
      const feedback = $('feedback').innerHTML;
      assert.match(feedback, /data-test=/);
      editor.setInputs([1]);
      assert.equal($('feedback').innerHTML, feedback);
      editor.click({ target: { closest: selector => selector === '[data-toggle]' ? { dataset: { toggle: 'in0' } } : null } });
      assert.equal($('feedback').innerHTML, feedback);
      const moved = copy(editor.circuit); moved.nodes[0].x += 10; editor.commit(moved, 'layout');
      editor.undo(); editor.redo();
      assert.equal($('feedback').innerHTML, feedback);
      $('feedback').emit('click', { closest: () => ({ dataset: { test: '1' } }) });
      assert.equal($('feedback').innerHTML, feedback);
      editor.commit(solvedLight());
      assert.doesNotMatch($('feedback').innerHTML, /data-test=/);
    });
    await t.test('hint levels are progressive; reset blocks undo/redo of hinted solution', () => {
      $('hint').click();
      assert.match($('hint-panel').innerHTML, /已查看 1\/3/);
      assert.doesNotMatch($('hint-panel').innerHTML, /点击 A 右边/);
      $('hint-panel').emit('click', { closest: () => ({}) });
      assert.match($('hint-panel').innerHTML, /已查看 2\/3/);
      $('hint-panel').emit('click', { closest: () => ({}) });
      assert.match($('hint-panel').innerHTML, /已查看 3\/3/);
      $('hint').click(); assert.equal($('hint-panel').hidden, true);
      $('run').click(); assert.equal($('earned-stars').textContent, '★★☆'); $('success-close').click();
      $('reset').click();
      assert.equal(editor.history.length, 0); assert.equal(editor.future.length, 0);
      assert.equal($('undo').disabled, true); assert.equal($('redo').disabled, true);
      editor.undo(); editor.redo();
      assert.equal(editor.circuit.wires.length, 0);
      assert.equal(page(storage).getLevel('first-light').hintsSeen, 0);
      assert.equal($('level-best').textContent, '★★☆');
      assert.match($('scene-status').textContent, /未知/);
    });
    await t.test('all scenes react to every input combination, with separate sum/carry and final router', () => {
      const scenes = new Set();
      LEVELS.forEach((level, index) => {
        select(index); $('reset').click();
        assert.match($('scene-status').textContent, /未知/);
        editor.commit(solution(level));
        const snapshots = new Set();
        for (let row = 0; row < 2 ** level.inputs.length; row++) {
          editor.setInputs(level.inputs.map((_, i) => (row >> (level.inputs.length - 1 - i)) & 1));
          assert.equal($('scene-status').textContent, '当前组合一致');
          assert.equal($('district').dataset.state, 'match');
          snapshots.add($('district-art').innerHTML);
        }
        assert.equal(snapshots.size, 2 ** level.inputs.length);
        scenes.add($('scene-title').textContent);
        if (level.id === 'half-adder') {
          assert.match($('scene-readings').innerHTML, /S（和）/);
          assert.match($('scene-readings').innerHTML, /C（进位）/);
          assert.match($('district-art').innerHTML, /C S = 10/);
        }
        $('run').click();
        assert.equal($('earned-stars').textContent, '★★★');
        if (level.id === 'selector') assert.match($('success-title').textContent, /路由/);
        $('success-close').click();
      });
      assert.equal(scenes.size, LEVELS.length);
      // A wrong circuit must show a real mismatch, not a decorative success mark.
      select(1); editor.commit(solvedLight()); editor.setInputs([0]);
      assert.equal($('district').dataset.state, 'mismatch');
      assert.equal($('scene-status').textContent, '当前组合不一致');
    });
    await t.test('a stale local edit conflicting with a hint update restores the latest persisted circuit', () => {
      select(0); $('reset').click();
      const remote = page(storage), latest = remote.getLevel('first-light');
      remote.revealHint('first-light', 1, latest.revision);
      // Deliberately edit before delivering the storage event.
      editor.commit(solvedLight());
      assert.equal(editor.circuit.wires.length, 0);
      assert.equal(editor.history.length, 0);
      assert.match($('hint').textContent, /1\/3/);
      assert.deepEqual(editor.circuit, remote.getLevel('first-light').draft);
      // Editing the refreshed record now saves normally, keeping the hint penalty.
      editor.commit(solvedLight());
      assert.equal(remote.getLevel('first-light').draft.wires.length, 1);
      assert.equal(remote.getLevel('first-light').hintsSeen, 1);
    });
    await t.test('storage refresh imports current challenge and clears old undo history', () => {
      select(0); const remote = page(storage);
      remote.reset('first-light', blank('first-light'));
      win.emit('storage', undefined, { key: levelKey('first-light') });
      assert.equal(editor.circuit.wires.length, 0);
      assert.equal(editor.history.length, 0); assert.equal(editor.future.length, 0);
      assert.equal($('level-best').textContent, '★★★');
      remote.revealHint('first-light', 1, remote.getLevel('first-light').revision);
      win.emit('storage', undefined, { key: levelKey('first-light') });
      assert.match($('hint').textContent, /1\/3/);
      edit(remote, 'opposite', solution(byId('opposite')));
      const latest = storage.getItem(levelKey('opposite'));
      select(1); select(0);
      assert.equal(storage.getItem(levelKey('opposite')), latest);
    });
  } finally {
    clearTimeout(notify.timer);
    Editor.prototype.render = originalRender;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});
