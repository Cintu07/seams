// Builds build/seams.wasm and build/seams_bad_hash.wasm from wasm/seams.wat.
// #field and @CONST come from layout.mjs; ;;IF NAME ... ;;END blocks are kept only when NAME is set.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import wabtInit from 'wabt';
import { FIELD, TABLE, CONST } from './layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'build');
const constants = { ...CONST, HASH_MULTIPLIER: '0x9e3779b97f4a7c15' };

function preprocess(text, flags) {
  text = text.replace(/;;IF (\w+)\n([\s\S]*?);;END\n/g, (_, name, body) => (flags.has(name) ? body : ''));
  const substitute = (code) => code
    .replace(/#(\w+)/g, (match, name) => {
      const offset = FIELD[name] ?? TABLE[name];
      if (offset === undefined) throw new Error(`unknown field #${name}`);
      return String(offset);
    })
    .replace(/@(\w+)/g, (match, name) => {
      if (!(name in constants)) throw new Error(`unknown constant @${name}`);
      return String(constants[name]);
    });
  // comments are left alone
  return text.split('\n').map((line) => {
    const comment = line.indexOf(';;');
    return comment < 0 ? substitute(line) : substitute(line.slice(0, comment)) + line.slice(comment);
  }).join('\n');
}

const wabt = await wabtInit();
const source = readFileSync(join(here, 'seams.wat'), 'utf8');
mkdirSync(out, { recursive: true });
for (const [file, flags] of [['seams.wasm', []], ['seams_bad_hash.wasm', ['BAD_HASH']]]) {
  let module;
  try {
    module = wabt.parseWat(file, preprocess(source, new Set(flags)), { simd: true, multi_value: true, bulk_memory: true });
    module.validate();
  } catch (error) {
    // wabt's own stack trace prints its whole minified source; the message is what matters
    console.error(String(error.message));
    process.exit(1);
  }
  const { buffer } = module.toBinary({});
  writeFileSync(join(out, file), buffer);
  module.destroy();
  console.log(`build/${file}: ${buffer.length} bytes`);
}
