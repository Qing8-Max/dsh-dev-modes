import { pathToFileURL } from 'node:url';

const target = pathToFileURL('C:/Users/huang/dsh-modes/dev-modes/index.js').href;
const mod = await import(target);
const registered = [];
let injectCalled = false;

mod.apply({
  inject(deps, callback) {
    injectCalled = true;
    if (!Array.isArray(deps) || deps[0] !== 'skills') throw new Error('unexpected inject deps: ' + JSON.stringify(deps));
    callback({ skills: { register(skill) { registered.push(skill); } } });
  },
});

console.log(JSON.stringify({
  injectCalled,
  exportsApply: typeof mod.apply === 'function',
  registeredCount: registered.length,
  skills: registered.map((s) => ({
    name: s.name,
    descriptionLength: s.description.length,
    hasWhenToUse: typeof s.whenToUse === 'string' && s.whenToUse.length > 0,
    contentChars: s.content.length,
    source: s.source,
    provider: s.provider,
  })),
}, null, 2));
