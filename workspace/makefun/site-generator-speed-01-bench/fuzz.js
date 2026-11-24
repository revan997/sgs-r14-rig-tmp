// fuzz.js — differential fuzz: candidate solve.js (working tree) vs the
// current build (HEAD 60ee3e0, extracted to /tmp/orig-solve/solve.js).
// Mutates the practice inputs (CRLF, tabs, construct-dense Markdown,
// Setext-like lines, nested emphasis/links, empty docs, front-matter edges,
// unicode) plus synthetic cases, and requires byte-identical outputs
// (JSON.stringify comparison) from both builds, and determinism (candidate
// run twice gives the same bytes).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.HOME, 'workspace/makefun/kits-20261123/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit');
const CASES = JSON.parse(readFileSync(join(KIT, 'practice/input/cases.json'), 'utf8'));

const candidate = await import(pathToFileURL(resolve(process.env.HOME, 'workspace/makefun/site-generator-speed-01-run-20261122/solve.js')).href);
const original = await import(pathToFileURL('/tmp/orig-solve/solve.js').href);

const clone = (o) => JSON.parse(JSON.stringify(o));

let passed = 0, failed = 0;
const failures = [];
function check(name, input) {
  let a, b, a2;
  try { a = JSON.stringify(candidate.run(input)); } catch (e) { a = `THREW ${e.message}`; }
  try { b = JSON.stringify(original.run(input)); } catch (e) { b = `THREW ${e.message}`; }
  try { a2 = JSON.stringify(candidate.run(input)); } catch (e) { a2 = `THREW ${e.message}`; }
  if (a === b && a === a2) { passed++; return; }
  failed++;
  let at = 0;
  if (a !== b) { while (at < Math.min(a.length, b.length) && a[at] === b[at]) at++; }
  failures.push({ name, at, a: String(a).slice(Math.max(0, at - 120), at + 200), b: String(b).slice(Math.max(0, at - 120), at + 200), det: a === a2 });
}

// --- mutations of the practice cases ---
const mdFiles = (input) => input.files.filter((f) => f.path.endsWith('.md'));
for (const c of CASES) {
  // 1. CRLF everywhere
  let m = clone(c.input);
  for (const f of mdFiles(m)) f.content = f.content.replace(/\n/g, '\r\n');
  check(`${c.id}/crlf`, m);
  // 2. lone CR line ends
  m = clone(c.input);
  for (const f of mdFiles(m)) f.content = f.content.replace(/\n/g, '\r');
  check(`${c.id}/cr-only`, m);
  // 3. tabs: indent every 3rd line with a tab, and tab-indented list continuations
  m = clone(c.input);
  for (const f of mdFiles(m)) f.content = f.content.split('\n').map((l, i) => (i % 3 === 0 ? `\t${l}` : l)).join('\n');
  check(`${c.id}/tabs`, m);
  // 4. construct-dense extra file appended to the site
  m = clone(c.input);
  m.files.push({ path: 'posts/dense.md', content: [
    '---', 'title: Dense Constructs', 'date: 2026-11-24', 'tags: [a, b]', '---',
    '# Dense **bold *nested em* bold** and `code & <stuff>`',
    '',
    'A **bold** B *em* C **unclosed bold D *unclosed em E `unclosed code F [unclosed link G.',
    'Escapes: \\*not em\\* \\`not code\\` \\[not link\\] \\\\ backslash \\> not quote \\! bang.',
    'Empty code `` and ``x`` and `a`b`c` and **a**b**c** and *a*b*c*.',
    '[ok](other-post) [frag](#sec) [abs](/root/page) [mail](mailto:a@b.c) [sp](has space) [empty]() [titled](t "T") [nested **bold** link](tgt) [a [b] c](tgt2).',
    'Ampersands & <angle> "quotes" \'single\' &amp; &lt; entities &copy;.',
    '***', '---', '___ not a rule', '#NoSpace', '####### seven', '# trailing #   ', '##  spaced  ##',
    'Setext line', '===========', 'Another', '-----------',
    '> quote *with* **markup**', '>> double', '> ', '>',
    '- dash item *em*', '* star item **bold**', '  continued line', '1. one', '10. ten', '1) paren not list', '999999999. huge',
    '```js', 'const x = "a & b"; // `tick` *star*', '```', '```unclosed fence', '```` four ticks',
    '',
  ].join('\n') });
  // a target for the relative links above
  m.files.push({ path: 'other-post.md', content: '---\ntitle: Other Post\ndate: 2026-11-23\n---\n# Other\n\nBody.\n' });
  check(`${c.id}/construct-dense`, m);
  // 5. empty docs: body empty, body only blanks, title-only
  m = clone(c.input);
  m.files.push({ path: 'posts/empty1.md', content: '---\ntitle: Empty One\ndate: 2026-11-24\n---\n' });
  m.files.push({ path: 'posts/empty2.md', content: '---\ntitle: Empty Two\ndate: 2026-11-24\n---\n\n\n   \n\t\n' });
  m.files.push({ path: 'about.md', content: '---\ntitle: About\n---\n' });
  check(`${c.id}/empty-docs`, m);
  // 6. unicode / slug stress in titles and headings
  m = clone(c.input);
  m.files.push({ path: 'posts/uni.md', content: [
    '---', 'title: "Café — naïve façade ☕ émigré"', 'date: 2026-11-24', 'tags: [Café, naïve, ☕]', '---',
    '# Café — naïve façade ☕', '## Titre avec é combining', '### Emoji 🎉 title 🎉',
    'CJK 漢字 and Arabic العربية and emoji 🎉🎉.',
    '',
  ].join('\n') });
  check(`${c.id}/unicode`, m);
  // 7. front-matter edges: quoted escapes, bad date, unknown key, dup key, no title, draft
  const fmCases = [
    ['---\ntitle: "a \\"quoted\\" and \\\\ back"\ndate: 2026-11-24\n---\n# Hi\n', 'fm-quoted'],
    ['---\ntitle: Bad Date\ndate: 2026-02-30\n---\n# Hi\n', 'fm-bad-date'],
    ['---\ntitle: Unknown\nnope: 1\n---\n# Hi\n', 'fm-unknown-key'],
    ['---\ntitle: Dup\ntitle: Again\n---\n# Hi\n', 'fm-dup-key'],
    ['---\ndate: 2026-11-24\n---\n# Hi\n', 'fm-no-title'],
    ['---\ntitle: Drafted\ndate: 2026-11-24\ndraft: true\n---\n# Hi\n', 'fm-draft'],
    ['---\ntitle: Tags\ndate: 2026-11-24\ntags: []\ntags: [x]\n---\n# Hi\n', 'fm-tags-dup'],
    ['---\ntitle: No Close\ndate: 2026-11-24\n', 'fm-unclosed'],
    ['no front matter at all\n', 'fm-none'],
    ['---\ntitle: Bad Slug\ndate: 2026-11-24\nslug: Bad_Slug!\n---\n# Hi\n', 'fm-bad-slug'],
  ];
  for (const [content, name] of fmCases) {
    m = clone(c.input);
    m.files.push({ path: `posts/${name}.md`, content });
    check(`${c.id}/${name}`, m);
  }
  // 7b. front-matter fast-path edges (item 8): bail paths + fast paths
  const fmCases2 = [
    ['---\ntitle: "a: b: c"\ndate: 2026-11-24\n---\n# Hi\n', 'fm-quoted-colon'],
    ['---\ntitle: say "hi" mid\ndate: 2026-11-24\n---\n# Hi\n', 'fm-bare-quote-mid'],
    ['---\n# a comment\ntitle: With Comment\ndate: 2026-11-24\n# another\n---\n# Hi\n', 'fm-comments'],
    ['---\n\ntitle: Blank Lines\n\ndate: 2026-11-24\n\n---\n# Hi\n', 'fm-blank-lines'],
    ['---\ntitle: Trail   \t \ndate: 2026-11-24\n---\n# Hi\n', 'fm-trailing-ws'],
    ['---\nTitle: Upper Key\ndate: 2026-11-24\n---\n# Hi\n', 'fm-upper-key'],
    ['---\ntitle:NoSpace\ndate: 2026-11-24\n---\n# Hi\n', 'fm-no-space'],
    ['---\n title: Leading Space\ndate: 2026-11-24\n---\n# Hi\n', 'fm-leading-space'],
    ['---\ntitle: A\n---\nbody has --- lines\n---\nmore\n', 'fm-body-dashes'],
    ['---\ntitle: A\n----\n# Hi\n', 'fm-four-dash'],
    ['---\ntitle: A\n--- \n# Hi\n', 'fm-close-trail-space'],
    ['---\ntitle: A\n---', 'fm-close-at-eof'],
    ['---\ntitle: A\n---\n', 'fm-close-then-empty'],
    ['---\n---\n# Hi\n', 'fm-empty-fm'],
    ['---\ntitle: A\ndate: 2026-02-29\n---\n# Hi\n', 'fm-nonleap'],
    ['---\ntitle: A\ndate: 2026-13-01\n---\n# Hi\n', 'fm-bad-month'],
    ['---\ntitle: A\ndraft: maybe\n---\n# Hi\n', 'fm-bad-draft'],
    ['---\ntitle: A\ntags: [a, b, c]\n---\n# Hi\n', 'fm-tags-spaces'],
    ['---\ntitle: A\ntags: [a,"b"]\n---\n# Hi\n', 'fm-tags-quote'],
    ['---\ntitle: A\nslug: a-b-c\nlayout: post\nsummary: A summary here\n---\n# Hi\n', 'fm-all-keys'],
    ['---\ntitle: "esc \\"q\\" and \\\\ back"\n---\n# Hi\n', 'fm-quoted-escapes'],
    ['---\ntitle: [bracket]\n---\n# Hi\n', 'fm-bracket-title'],
    ['---\ntitle: A\ntitle: B\n---\n# Hi\n', 'fm-dup-after-ok'],
    ['---\ntitle:\n---\n# Hi\n', 'fm-empty-value'],
    ['---\ntitle: \n---\n# Hi\n', 'fm-space-value'],
    ['---\nkey_with_underscore: 1\ntitle: A\n---\n# Hi\n', 'fm-underscore-key'],
  ];
  for (const [content, name] of fmCases2) {
    m = clone(c.input);
    m.files.push({ path: `posts/${name}.md`, content });
    check(`${c.id}/${name}`, m);
  }
  // 8. inline torture: every special char adjacent to constructs
  m = clone(c.input);
  m.files.push({ path: 'posts/torture.md', content: [
    '---', 'title: Torture', 'date: 2026-11-24', '---',
    '***triple*** ****quad**** *****five*****',
    '`code **not bold**` **bold `not code` bold** *em `not code` em*',
    '[**bold link**](tgt) [**bold**](tgt) [*em*](tgt) [`code`](tgt)',
    'a**b**c *d*e* f`g`h [i](j)k l\\*m\\*n',
    '&<>\"\' all five &amp; then **bold & <tag>**',
    'trailing backslash \\',
    'backslash at end of **bold \\**',
    '',
  ].join('\n') });
  check(`${c.id}/inline-torture`, m);
}

// --- synthetic standalone cases (fresh templates, edge inputs) ---
const synthTemplates = {
  post: '<html><head><title>{{ site.title }} - {{ page.title }}</title></head><body>{{{ page.content }}}<p>{{ page.excerpt }}</p>{% for t in page.tags %}[{{ t.name }}:{{ t.url }}]{% endfor %}</body></html>',
  page: '<html><body><h1>{{ page.title }}</h1>{{{ page.content }}}</body></html>',
  index: '<html><body>{% for p in posts %}{{ p.title }}|{{ p.reading_minutes }};{% endfor %}</body></html>',
  tag: '<html><body>{{ tag.name }}({{ tag.count }})</body></html>',
  tags: '<html><body>{% for t in tags %}{{ t.name }}:{{ t.count }};{% endfor %}</body></html>',
};
function synthCase(name, files) {
  return { site: { title: 'Synth & <Site>', base_url: 'https://example.test/blog/', per_page: 2, recent: 2 }, templates: synthTemplates, files };
}
check('synth/empty-site', synthCase('empty', []));
check('synth/one-empty-md', synthCase('one', [{ path: 'index.md', content: '---\ntitle: Home\n---\n' }]));
check('synth/static-only', synthCase('static', [{ path: 'style.css', content: 'a{color:red}' }, { path: 'x.txt', content: 'hi' }]));
check('synth/nested-emphasis', synthCase('nested', [{ path: 'posts/n.md', content: '---\ntitle: N\ndate: 2026-01-01\n---\n**a *b **c* d** e* f\n\n*g **h *i* j** k*\n' }]));
check('synth/link-edge', synthCase('links', [
  { path: 'posts/l.md', content: '---\ntitle: L\ndate: 2026-01-01\n---\n[a](b.md) [c](./d.md) [e](../f.md) [g](h.md#x) [i]() [j](k l) [m](n)o\n' },
  { path: 'posts/b.md', content: '---\ntitle: B\ndate: 2026-01-02\n---\nB\n' },
  { path: 'posts/d.md', content: '---\ntitle: D\ndate: 2026-01-03\n---\nD\n' },
  { path: 'f.md', content: '---\ntitle: F\n---\nF\n' },
]));
check('synth/long-plain', synthCase('longplain', [{ path: 'posts/lp.md', content: `---\ntitle: LP\ndate: 2026-01-01\n---\n${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(200)}\n\n${'Plain paragraph without any markup at all. '.repeat(100)}\n` }]));

// --- item 5: block-lexer differential (index-walk vs split) ---
function mdCase(name, body) {
  return synthCase(name, [{ path: 'posts/b.md', content: `---\ntitle: B\ndate: 2026-01-01\n---\n${body}` }]);
}
const blockBodies = [
  ['blk/trailing-nl', '# H\n\nPara.\n'],
  ['blk/no-trailing-nl', '# H\n\nPara.'],
  ['blk/only-nl', '\n'],
  ['blk/only-nls', '\n\n\n'],
  ['blk/empty', ''],
  ['blk/setext-eq', 'Para line\n===========\n\nNext.\n'],
  ['blk/setext-dash', 'Para line\n-----------\n\nNext.\n'],
  ['blk/hr-variants', '---\n\n***\n\n--- x\n\n--\n\n**\n'],
  ['blk/fence-unclosed', '```js\nconst a = 1;\nconst b = 2;'],
  ['blk/fence-trail-sp', '```js   \ncode\n```   \n\nAfter.\n'],
  ['blk/fence-empty', '```\n```\n\nAfter.\n'],
  ['blk/fence-4tick', '````\ncode\n````\n'],
  ['blk/fence-lang-bad', '```js!\ncode\n```\n'],
  ['blk/quote-variants', '> q1\n>q2\n>\n> \n>> double\n\nAfter.\n'],
  ['blk/quote-then-para', '> quoted\nnot quoted\n'],
  ['blk/list-cont', '- a\n  continued\n  more\n- b\n* c\n  cont\n'],
  ['blk/list-ordered', '3. three\n4. four\n  cont\n10. ten\n999999999. huge\n1) paren\n'],
  ['blk/list-9digit', '123456789. nine\n1234567890. ten-digit\n'],
  ['blk/heading-variants', '#\n##\n####### seven\n#NoSpace\n# ok #\n##  spaced  ##\n'],
  ['blk/para-ends', 'para one\npara two\n# Head\npara three\n```\ncode\n```\npara four\n---\npara five\n'],
  ['blk/blank-spaces', '   \n\t\npara\n   \n'],
  ['blk/tab-indent-para', '\tindented para\n\tmore\n'],
  ['blk/bullet-nospace', '-nospace\n*nospace\n- ok\n'],
  ['blk/mixed', '# T\n\n> q\n> q2\n\n- a\n- b\n\n1. one\n2. two\n\nPara *em* **bold**.\n\n```\ncode & <x>\n```\n'],
  ['blk/hr-in-para', 'line one\n---\nline two\n'],
  ['blk/star-hr', 'text\n***\ntext\n'],
];
for (const [name, body] of blockBodies) check(name, mdCase(name, body));
for (const [name, body] of blockBodies) check(`${name}/crlf`, mdCase(name, body.replace(/\n/g, '\r\n')));

console.log(`fuzz: ${passed} passed, ${failed} failed`);
for (const f of failures) console.log('FAIL', f.name, 'at', f.at, 'det-ok:', f.det, '\n  candidate:', f.a, '\n  original :', f.b);
process.exit(failed === 0 ? 0 : 1);
