export const LEGACY_KEY = 'gate-quest:progress:v1';
export const PROGRESS_PREFIX = 'gate-quest:progress:v2:';
const LEGACY_ORDER = ['first-light', 'opposite', 'two-keys', 'backup', 'different', 'universal', 'selector', 'half-adder'];
const clone = value => structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const starCount = value => Number.isInteger(value) && value >= 1 && value <= 3 ? value : 0;
const hintCount = value => Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;

// Revision checks detect stale drafts; localStorage cannot make simultaneous same-level edits atomic.
export function createProgress({ levels, storage, validateDraft = (_, draft) => draft, onError = () => {} }) {
  const ids = levels.map(level => typeof level === 'string' ? level : level.id);
  const memory = new Map(), pending = new Map(), best = new Map();
  let warned = false;
  const fail = error => { if (!warned) { warned = true; onError(error); } };
  const backend = () => typeof storage === 'function' ? storage() : storage;
  const revision = () => crypto.randomUUID();
  const levelKey = id => `${PROGRESS_PREFIX}level:${id}`;
  const assertId = id => { if (!ids.includes(id)) throw new Error('未知关卡。'); };
  function read(key) {
    if (pending.has(key)) return pending.get(key);
    try {
      const value = backend().getItem(key);
      memory.set(key, value);
      return value;
    } catch (error) { fail(error); return memory.get(key) ?? null; }
  }
  function write(key, value) {
    memory.set(key, value);
    try { backend().setItem(key, value); pending.delete(key); return true; }
    catch (error) { pending.set(key, value); fail(error); return false; }
  }
  function parse(key) {
    const text = read(key);
    if (text === null) return null;
    try { return JSON.parse(text); }
    catch (error) { fail(error); return null; }
  }
  const legacy = () => { const value = parse(LEGACY_KEY); return object(value) ? value : {}; };
  function validDraft(id, draft) {
    if (!draft) return null;
    try { return clone(validateDraft(id, clone(draft))); }
    catch { return null; }
  }
  function getLevel(id) {
    assertId(id);
    const stored = parse(levelKey(id));
    if (object(stored) && stored.version === 2 && typeof stored.revision === 'string' && typeof stored.challenge === 'string') {
      return { draft: validDraft(id, stored.draft), hintsSeen: hintCount(stored.hintsSeen), challenge: stored.challenge, revision: stored.revision };
    }
    const old = legacy();
    return {
      draft: validDraft(id, old.drafts?.[id]),
      // The old single hint exposed the full connection recipe.
      hintsSeen: old.usedHints?.[id] === true ? 3 : 0,
      challenge: `legacy:${id}`, revision: 'legacy',
    };
  }
  function putLevel(id, record) {
    const next = { ...record, revision: revision() };
    const saved = write(levelKey(id), JSON.stringify({ version: 2, ...next }));
    return { record: clone(next), saved, conflict: false };
  }
  function saveDraft(id, draft, expectedRevision) {
    const current = getLevel(id);
    if (current.revision !== expectedRevision) return { record: current, saved: false, conflict: true };
    const valid = validDraft(id, draft);
    if (!valid) throw new Error('无法保存无效的关卡电路。');
    if (JSON.stringify(valid) === JSON.stringify(current.draft)) return { record: current, saved: true, conflict: false };
    return putLevel(id, { ...current, draft: valid });
  }
  function revealHint(id, step, expectedRevision) {
    const current = getLevel(id);
    if (current.revision !== expectedRevision) return { record: current, saved: false, conflict: true };
    const nextStep = Math.min(3, current.hintsSeen + 1);
    if (step !== nextStep || current.hintsSeen === 3) return { record: current, saved: true, conflict: false };
    return putLevel(id, { ...current, hintsSeen: nextStep });
  }
  function reset(id, draft) {
    assertId(id);
    const valid = validDraft(id, draft);
    if (!valid) throw new Error('无法重置无效的关卡电路。');
    return putLevel(id, { draft: valid, hintsSeen: 0, challenge: revision() });
  }
  function getStars(id) {
    assertId(id);
    let value = Math.max(best.get(id) || 0, starCount(legacy().progress?.[id]));
    for (let stars = 1; stars <= 3; stars++) {
      if (read(`${PROGRESS_PREFIX}star:${id}:${stars}`) === '1') value = Math.max(value, stars);
    }
    best.set(id, value);
    return value;
  }
  function award(id, stars) {
    assertId(id);
    if (!starCount(stars)) throw new Error('星级必须为 1–3。');
    // Preserve legacy/local best even if this challenge earned fewer stars.
    const highest = Math.max(getStars(id), stars);
    write(`${PROGRESS_PREFIX}star:${id}:${highest}`, '1');
    best.set(id, highest);
    return getStars(id);
  }
  function getSelection() {
    const selected = read(`${PROGRESS_PREFIX}selected`);
    if (ids.includes(selected)) return selected;
    const oldIndex = legacy().index;
    const oldId = Number.isInteger(oldIndex) ? LEGACY_ORDER[oldIndex] : null;
    return ids.includes(oldId) ? oldId : ids[0];
  }
  function select(id) { assertId(id); return write(`${PROGRESS_PREFIX}selected`, id); }
  return {
    getLevel, saveDraft, revealHint, reset, getStars, award, getSelection, select,
    isStorageKey: key => key === null || key === LEGACY_KEY || key?.startsWith(PROGRESS_PREFIX),
  };
}
