// node web/test_lex.mjs: every language lexes a line the way it should, and file names map to languages
import { lexLine, language, languageOf, PLAIN, KEYWORD, TYPE, STRING, NUMBER, COMMENT, FUNC } from './lex.mjs';

const NAMES = { [PLAIN]: '.', [KEYWORD]: 'k', [TYPE]: 't', [STRING]: 's', [NUMBER]: 'n', [COMMENT]: 'c', [FUNC]: 'f' };
let failed = 0;
// `want` is one letter per byte of `line`, using NAMES; spaces in `want` mean "don't care"
function check(lang, line, want) {
  const bytes = new TextEncoder().encode(line);
  const out = new Uint8Array(bytes.length);
  lexLine(language(lang), bytes, 0, bytes.length, 0, out);
  const got = Array.from(out, (c) => NAMES[c]).join('');
  for (let i = 0; i < want.length; ++i) {
    if (want[i] !== ' ' && want[i] !== got[i]) {
      console.log(`FAIL ${lang}: ${JSON.stringify(line)}\n  want ${want}\n  got  ${got}`);
      ++failed;
      return;
    }
  }
}

check('java', 'public int x = 42; // hi', 'kkkkkk.ttt.....nn..ccccc');
check('java', 'String s = """', 'tttttt . . sss');
check('kotlin', 'fun main() = println("x")', 'kkk.ffff.....fffffff.sss.');
check('csharp', '#region Foo', 'kkkkkkk');
check('csharp', 'var n = null;', 'kkk . . nnnn.');
check('swift', 'guard let x else { return nil }', 'kkkkk kkk . kkkk . kkkkkk nnn .');
check('scala', 'val xs: List[Int] = Nil', 'kkk ... tttt.ttt. . nnn');
check('ruby', 'def go(x) # call', 'kkk ff    cccccc');
check('shell', 'echo $# ${#a} # real', '..............cccccc');
check('shell', 'if [ -f x ]; then', 'kk...........kkkk');
check('php', '$x = "a"; # c', '   . sss. ccc');
check('lua', 'local x = 1 -- note', 'kkkkk . . n ccccccc');
check('sql', 'SELECT id FROM t -- x', 'kkkkkk .. kkkk . cccc');
check('sql', 'create table t (id uuid)', 'kkkkkk.kkkkk.f.....tttt.');
check('zig', 'pub fn main() !void {', 'kkk kk ffff   .tttt .');
check('nasm', 'mov rax, [rdi] ; load', '... ttt. .ttt. cccccc');
check('nasm', '%define LIMIT 4096', 'kkkkkkk ttttt nnnn');
check('nasm', 'SECTION .text', 'kkkkkkk');
check('wat', '(func $f (param i32) ;; x', '.kkkk..f..kkkkk.ttt..cccc');
check('config', 'name: "x" # yes', '      sss ccccc');
check('config', 'url=http://a#b', '..............');
check('json', '{"a": true, "b": 1}', '.sss. nnnn. sss. n.');
check('css', '@media (x) { a { color: red } }', 'kkkkkk');
check('css', '/* c */ a { }', 'ccccccc');

const names = {
  'A.java': 'java', 'b.kt': 'kotlin', 'c.cs': 'csharp', 'd.swift': 'swift', 'e.rb': 'ruby', 'f.sh': 'shell',
  'g.php': 'php', 'h.lua': 'lua', 'i.sql': 'sql', 'j.zig': 'zig', 'src/myers.asm': 'nasm', 'include/layout.inc': 'nasm',
  'wasm/seams.wat': 'wat', 'ci.yml': 'config', 'Cargo.toml': 'config', 'package.json': 'json', 'site.css': 'css',
  'makefile': 'config', 'path/to/Dockerfile': 'config', 'Gemfile': 'ruby', 'x.ts': 'ts', 'y.rs': 'rust', 'README': null,
  'a\\b\\c.go': 'go',
};
for (const [name, want] of Object.entries(names)) {
  const got = languageOf(name);
  if (got !== want) { console.log(`FAIL languageOf(${name}) = ${got}, want ${want}`); ++failed; }
}
console.log(failed ? `${failed} failed` : 'lexers ok');
process.exit(failed ? 1 : 0);
