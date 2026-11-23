// solve.js — fast drop-in reimplementation of the makefun-site 1.0.0 build,
// written to the interface stated in the bounty brief for
// "Build a static site faster, 22 November 2026" (make.fun):
//
//   run(input) -> { [outputPath]: fileText }
//
// input is one case: { site, templates, files }
//   site:      site configuration object (e.g. { title, ... })
//   templates: { name: templateText } (or [{ name, content }])
//   files:     { path: text } (or [{ path, content }]) — Markdown sources
//              plus a few static files
// The answer is the whole output tree as one JSON-able object: every page's
// index.html, the index page, the tag pages, build-report.txt and each
// static file, byte for byte.
//
// Performance approach (all state is per-run: nothing is cached from one
// case to the next, as the brief requires):
//   - templates are compiled once per run into plain JS functions
//   - Markdown is rendered by a single-pass, char-code scanner (no regex
//     splitting of the document, no intermediate token tree)
//   - slugs are memoised per run
//   - HTML escaping is a single scan that copies clean runs in slices
//   - output is assembled with array joins, never string += in hot loops

'use strict';

// ---------------------------------------------------------------- utilities

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// Single-scan HTML escape: copies the longest clean run with one slice.
export function esc(s) {
  let out = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const rep = ESC_MAP[s[i]];
    if (rep !== undefined) {
      if (out === null) out = s.slice(0, i);
      else if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (out === null) return s;
  return start < s.length ? out + s.slice(start) : out;
}

// Slug rule: Unicode-normalise (Node's String.prototype.normalize), fold to
// lower case, drop combining marks, map every run of non-alphanumerics to
// one '-', trim '-' at both ends. Memoised per run by the caller.
export function slugifyRaw(s) {
  const n = s.normalize('NFKD');
  let out = '';
  let lastDash = true; // trims a leading dash for free
  for (let i = 0; i < n.length; i++) {
    const c = n.charCodeAt(i);
    if (c >= 0x300 && c <= 0x36f) continue; // combining diacriticals
    let ch = n[i];
    let cc = c;
    if (c >= 65 && c <= 90) {
      cc = c + 32;
      ch = String.fromCharCode(cc);
    }
    const alnum =
      (cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57) || cc > 127;
    if (alnum) {
      out += ch;
      lastDash = false;
    } else if (!lastDash) {
      out += '-';
      lastDash = true;
    }
  }
  return lastDash && out.endsWith('-') ? out.slice(0, -1) : out;
}

// ------------------------------------------------------- front matter

// Parses a leading `---` fenced block of `key: value` lines. Returns
// [meta, bodyStart]. Values: plain scalars, `true`/`false`, or lists in
// `[a, b]` or comma form for the `tags` key.
function parseFrontMatter(src) {
  if (!src.startsWith('---')) return [null, 0];
  const end = src.indexOf('\n---', 3);
  if (end === -1) return [null, 0];
  const meta = {};
  const block = src.slice(3, end);
  let i = 0;
  const n = block.length;
  while (i < n) {
    let j = block.indexOf('\n', i);
    if (j === -1) j = n;
    const line = block.slice(i, j).trim();
    i = j + 1;
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val
        .slice(1, -1)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (key === 'tags') {
      meta[key] = val.split(',').map((t) => t.trim()).filter(Boolean);
    } else if (val === 'true') meta[key] = true;
    else if (val === 'false') meta[key] = false;
    else {
      if (
        val.length >= 2 &&
        ((val[0] === '"' && val.endsWith('"')) ||
          (val[0] === "'" && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  }
  let body = end + 4; // skip "\n---"
  if (src[body] === '\r') body++;
  if (src[body] === '\n') body++;
  return [meta, body];
}

// ------------------------------------------------------- Markdown subset
//
// Single-pass block scanner over lines, with a char-code inline renderer.
// Blocks: ATX headings, fenced code, unordered/ordered lists, blockquotes,
// horizontal rules, paragraphs. Inline: `code`, **bold**, *italic*,
// [text](href), ![alt](src). Raw text is HTML-escaped.

function renderInline(s) {
  const parts = [];
  const n = s.length;
  let i = 0;
  let textStart = 0;
  const flush = (upto) => {
    if (upto > textStart) parts.push(esc(s.slice(textStart, upto)));
  };
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 96) {
      // `code`
      const j = s.indexOf('`', i + 1);
      if (j !== -1) {
        flush(i);
        parts.push('<code>', esc(s.slice(i + 1, j)), '</code>');
        i = textStart = j + 1;
        continue;
      }
    } else if (c === 42) {
      // * or **
      if (s.charCodeAt(i + 1) === 42) {
        const j = s.indexOf('**', i + 2);
        if (j !== -1) {
          flush(i);
          parts.push('<strong>', renderInline(s.slice(i + 2, j)), '</strong>');
          i = textStart = j + 2;
          continue;
        }
      } else {
        const j = s.indexOf('*', i + 1);
        if (j > i + 1) {
          flush(i);
          parts.push('<em>', renderInline(s.slice(i + 1, j)), '</em>');
          i = textStart = j + 1;
          continue;
        }
      }
    } else if (c === 33 && s.charCodeAt(i + 1) === 91) {
      // ![alt](src)
      const mid = s.indexOf('](', i + 2);
      if (mid !== -1) {
        const j = s.indexOf(')', mid + 2);
        if (j !== -1) {
          flush(i);
          parts.push(
            '<img src="',
            esc(s.slice(mid + 2, j)),
            '" alt="',
            esc(s.slice(i + 2, mid)),
            '">'
          );
          i = textStart = j + 1;
          continue;
        }
      }
    } else if (c === 91) {
      // [text](href)
      const mid = s.indexOf('](', i + 1);
      if (mid !== -1) {
        const j = s.indexOf(')', mid + 2);
        if (j !== -1) {
          flush(i);
          parts.push(
            '<a href="',
            esc(s.slice(mid + 2, j)),
            '">',
            renderInline(s.slice(i + 1, mid)),
            '</a>'
          );
          i = textStart = j + 1;
          continue;
        }
      }
    }
    i++;
  }
  flush(n);
  return parts.join('');
}

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 13) return false;
  }
  return true;
}

export function renderMarkdown(src, start) {
  const out = [];
  const n = src.length;
  let i = start;
  let para = null; // accumulated paragraph lines

  const flushPara = () => {
    if (para !== null) {
      out.push('<p>', renderInline(para.join(' ')), '</p>\n');
      para = null;
    }
  };

  while (i < n) {
    let j = src.indexOf('\n', i);
    if (j === -1) j = n;
    const line = src.slice(i, j);
    const next = j + 1;

    if (isBlank(line)) {
      flushPara();
      i = next;
      continue;
    }

    const c0 = line.charCodeAt(0);

    if (c0 === 35) {
      // # heading
      let level = 0;
      while (level < line.length && line.charCodeAt(level) === 35) level++;
      if (level <= 6 && line.charCodeAt(level) === 32) {
        flushPara();
        out.push(
          '<h',
          level,
          '>',
          renderInline(line.slice(level + 1).trim()),
          '</h',
          level,
          '>\n'
        );
        i = next;
        continue;
      }
    }

    if (c0 === 96 && line.startsWith('```')) {
      flushPara();
      const buf = [];
      i = next;
      while (i < n) {
        let k = src.indexOf('\n', i);
        if (k === -1) k = n;
        const l = src.slice(i, k);
        i = k + 1;
        if (l.startsWith('```')) break;
        buf.push(l);
      }
      out.push('<pre><code>', esc(buf.join('\n')), '\n</code></pre>\n');
      continue;
    }

    if (
      (c0 === 45 || c0 === 42) &&
      line.charCodeAt(1) === 32 &&
      line.length > 2
    ) {
      // unordered list (single level)
      flushPara();
      const items = ['<ul>\n'];
      let cur = i;
      while (cur < n) {
        let k = src.indexOf('\n', cur);
        if (k === -1) k = n;
        const l = src.slice(cur, k);
        const cc = l.charCodeAt(0);
        if ((cc === 45 || cc === 42) && l.charCodeAt(1) === 32) {
          items.push('<li>', renderInline(l.slice(2)), '</li>\n');
          cur = k + 1;
        } else break;
      }
      items.push('</ul>\n');
      out.push(items.join(''));
      i = cur;
      continue;
    }

    if (c0 >= 48 && c0 <= 57) {
      // ordered list "1. "
      const dot = line.indexOf('. ');
      if (dot >= 1 && dot <= 9) {
        flushPara();
        const items = ['<ol>\n'];
        let cur = i;
        while (cur < n) {
          let k = src.indexOf('\n', cur);
          if (k === -1) k = n;
          const l = src.slice(cur, k);
          const d = l.indexOf('. ');
          const cc = l.charCodeAt(0);
          if (d >= 1 && d <= 9 && cc >= 48 && cc <= 57) {
            items.push('<li>', renderInline(l.slice(d + 2)), '</li>\n');
            cur = k + 1;
          } else break;
        }
        items.push('</ol>\n');
        out.push(items.join(''));
        i = cur;
        continue;
      }
    }

    if (c0 === 62) {
      // > blockquote
      flushPara();
      const buf = [];
      let cur = i;
      while (cur < n) {
        let k = src.indexOf('\n', cur);
        if (k === -1) k = n;
        const l = src.slice(cur, k);
        if (l.charCodeAt(0) === 62) {
          buf.push(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
          cur = k + 1;
        } else break;
      }
      out.push(
        '<blockquote>\n',
        renderMarkdown(buf.join('\n'), 0),
        '</blockquote>\n'
      );
      i = cur;
      continue;
    }

    if (
      line === '---' ||
      line === '***' ||
      line === '___' ||
      line === '- - -'
    ) {
      flushPara();
      out.push('<hr>\n');
      i = next;
      continue;
    }

    if (para === null) para = [line];
    else para.push(line);
    i = next;
  }
  flushPara();
  return out.join('');
}

// ------------------------------------------------------- templates
//
// Dialect (compiled to JS functions, one compile per template per run):
//   {{ path }}            escaped interpolation, dotted lookup
//   {{{ path }}}          raw interpolation
//   {{#each items}}...{{/each}}   loop; {{this}}, {{@index}}, fields of item
//   {{#if path}}...{{else}}...{{/if}}
//   {{> name}}            partial (another template, same context)
//   {{! comment}}

function lookup(ctx, path) {
  if (path === 'this' || path === '.') return ctx;
  let cur = ctx;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function compileTemplate(text) {
  // Tokenise once into a node tree; rendering walks the tree (see
  // renderNodes). An if-node's `children` is its then-branch and its
  // `elseChildren` (once {{else}} is seen) collects the else-branch.
  const root = { kind: 'root', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const active = () => {
    const t = top();
    return t.kind === 'if' && t.elseChildren ? t.elseChildren : t.children;
  };
  const push = (node) => active().push(node);
  const pushText = (t) => {
    if (t) push({ kind: 'text', text: t });
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const open = text.indexOf('{{', i);
    if (open === -1) {
      pushText(text.slice(i));
      break;
    }
    pushText(text.slice(i, open));
    if (text.charCodeAt(open + 2) === 123) {
      // {{{ raw }}}
      const close = text.indexOf('}}}', open + 3);
      const path = text.slice(open + 3, close).trim();
      push({ kind: 'raw', path });
      i = close + 3;
      continue;
    }
    const close = text.indexOf('}}', open + 2);
    const inner = text.slice(open + 2, close).trim();
    i = close + 2;
    const c0 = inner.charCodeAt(0);
    if (c0 === 33) continue; // comment
    if (c0 === 62) {
      push({ kind: 'partial', name: inner.slice(1).trim() });
    } else if (inner.startsWith('#each ')) {
      const node = { kind: 'each', path: inner.slice(6).trim(), children: [] };
      push(node);
      stack.push(node);
    } else if (inner.startsWith('#if ')) {
      const node = {
        kind: 'if',
        path: inner.slice(4).trim(),
        children: [],
        elseChildren: null,
      };
      push(node);
      stack.push(node);
    } else if (inner === 'else') {
      const node = top();
      if (node.kind === 'if') node.elseChildren = [];
    } else if (c0 === 47) {
      stack.pop(); // /each or /if
    } else {
      push({ kind: 'var', path: inner });
    }
  }
  return root;
}

function renderNodes(nodes, ctx, partials, out) {
  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k];
    switch (node.kind) {
      case 'text':
        out.push(node.text);
        break;
      case 'var': {
        const v = lookup(ctx, node.path);
        if (v !== undefined && v !== null) out.push(esc(String(v)));
        break;
      }
      case 'raw': {
        const v = lookup(ctx, node.path);
        if (v !== undefined && v !== null) out.push(String(v));
        break;
      }
      case 'partial': {
        const p = partials.get(node.name);
        if (p) renderNodes(p.children, ctx, partials, out);
        break;
      }
      case 'each': {
        const arr = lookup(ctx, node.path);
        if (Array.isArray(arr)) {
          for (let idx = 0; idx < arr.length; idx++) {
            const item = arr[idx];
            const childCtx =
              item !== null && typeof item === 'object'
                ? Object.assign(Object.create(ctx), item, {
                    this: item,
                    '@index': idx,
                  })
                : Object.assign(Object.create(ctx), {
                    this: item,
                    '@index': idx,
                  });
            renderNodes(node.children, childCtx, partials, out);
          }
        }
        break;
      }
      case 'if': {
        const v = lookup(ctx, node.path);
        if (v) renderNodes(node.children, ctx, partials, out);
        else if (node.elseChildren) {
          // else branch was folded into children swap above only when the
          // template used {{else}}; see compileTemplate note.
          renderNodes(node.elseChildren, ctx, partials, out);
        }
        break;
      }
    }
  }
}

// ------------------------------------------------------- the build

function asMap(x) {
  if (!x) return new Map();
  if (x instanceof Map) return x;
  if (Array.isArray(x)) {
    const m = new Map();
    for (const e of x) m.set(e.name ?? e.path, e.content ?? e.text ?? '');
    return m;
  }
  return new Map(Object.entries(x));
}

export function run(input) {
  const site = input.site || {};
  const templates = asMap(input.templates);
  const files = asMap(input.files);

  // Per-run compiled templates and slug memo (never shared across cases).
  const compiled = new Map();
  for (const [name, text] of templates) compiled.set(name, compileTemplate(text));
  const slugMemo = new Map();
  const slugify = (s) => {
    let v = slugMemo.get(s);
    if (v === undefined) {
      v = slugifyRaw(s);
      slugMemo.set(s, v);
    }
    return v;
  };
  const renderWith = (name, ctx) => {
    const t = compiled.get(name);
    if (!t) return '';
    const out = [];
    renderNodes(t.children, ctx, compiled, out);
    return out.join('');
  };

  const pages = [];
  const statics = [];
  for (const [path, text] of files) {
    if (path.endsWith('.md') || path.endsWith('.markdown')) {
      const [meta, bodyStart] = parseFrontMatter(text);
      const m = meta || {};
      if (m.draft === true) continue;
      const base = path.split('/').pop().replace(/\.(md|markdown)$/, '');
      const title = m.title || base;
      const slug = m.slug ? slugify(String(m.slug)) : slugify(String(title));
      pages.push({
        title,
        slug,
        date: m.date || '',
        tags: Array.isArray(m.tags) ? m.tags : [],
        template: m.template || m.layout || 'page',
        meta: m,
        content: renderMarkdown(text, bodyStart),
        source: path,
      });
    } else {
      statics.push([path, text]);
    }
  }

  // Deterministic order: by slug, then title.
  pages.sort((a, b) =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.title < b.title ? -1 : 1
  );

  const out = {};

  for (const p of pages) {
    const ctx = {
      site,
      page: p,
      title: p.title,
      slug: p.slug,
      date: p.date,
      tags: p.tags,
      content: p.content,
      pages,
    };
    out[p.slug + '/index.html'] = renderWith(p.template, ctx) || p.content;
  }

  // Index page.
  const indexCtx = { site, pages, title: site.title || '' };
  out['index.html'] = compiled.has('index')
    ? renderWith('index', indexCtx)
    : '<!doctype html>\n<title>' +
      esc(String(site.title || '')) +
      '</title>\n' +
      pages
        .map((p) => '<a href="' + p.slug + '/">' + esc(p.title) + '</a>\n')
        .join('');

  // Tag pages.
  const byTag = new Map();
  for (const p of pages) {
    for (const t of p.tags) {
      let arr = byTag.get(t);
      if (!arr) byTag.set(t, (arr = []));
      arr.push(p);
    }
  }
  const tagNames = [...byTag.keys()].sort();
  for (const t of tagNames) {
    const ts = slugify(t);
    const ctx = { site, tag: t, pages: byTag.get(t), title: t };
    out['tags/' + ts + '/index.html'] = compiled.has('tag')
      ? renderWith('tag', ctx)
      : '<!doctype html>\n<title>' +
        esc(t) +
        '</title>\n' +
        byTag
          .get(t)
          .map((p) => '<a href="' + p.slug + '/">' + esc(p.title) + '</a>\n')
          .join('');
  }

  // Static files, verbatim.
  statics.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [path, text] of statics) out[path] = text;

  // Build report.
  const report = [];
  report.push('pages: ' + pages.length);
  report.push('tags: ' + tagNames.length);
  report.push('static: ' + statics.length);
  const paths = Object.keys(out).sort();
  for (const p of paths) report.push(p + ' ' + out[p].length);
  out['build-report.txt'] = report.join('\n') + '\n';

  return out;
}

export default { run };
