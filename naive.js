// naive.js — a deliberately straightforward implementation of the same
// assumed makefun-site dialect as solve.js: line splitting with regexes,
// token-array Markdown, and string-replace template rendering. It exists
// only as the local reference to benchmark solve.js against (the real
// makefun-site 1.0.0 source ships inside the bounty kit, which needs an
// account key to download, so it could not be obtained here). Both
// implementations must produce byte-identical output on the generated
// test cases; bench.mjs verifies that before timing either.

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0080-\uffff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontMatter(src) {
  if (!src.startsWith('---')) return [null, src];
  const end = src.indexOf('\n---', 3);
  if (end === -1) return [null, src];
  const meta = {};
  for (const rawLine of src.slice(3, end).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map((t) => t.trim()).filter(Boolean);
    } else if (key === 'tags') {
      meta[key] = val.split(',').map((t) => t.trim()).filter(Boolean);
    } else if (val === 'true') meta[key] = true;
    else if (val === 'false') meta[key] = false;
    else {
      if (
        val.length >= 2 &&
        ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  }
  let body = src.slice(end + 4);
  if (body.startsWith('\r')) body = body.slice(1);
  if (body.startsWith('\n')) body = body.slice(1);
  return [meta, body];
}

function renderInline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function renderMarkdown(src) {
  const lines = src.split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push('<p>' + renderInline(para.join(' ')) + '</p>\n');
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    const h = line.match(/^(#{1,6}) (.*)$/);
    if (h) {
      flush();
      out.push('<h' + h[1].length + '>' + renderInline(h[2].trim()) + '</h' + h[1].length + '>\n');
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push('<pre><code>' + esc(buf.join('\n')) + '\n</code></pre>\n');
      continue;
    }
    if (/^[-*] /.test(line)) {
      flush();
      const items = ['<ul>\n'];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push('<li>' + renderInline(lines[i].slice(2)) + '</li>\n');
        i++;
      }
      items.push('</ul>\n');
      out.push(items.join(''));
      continue;
    }
    if (/^\d+\. /.test(line)) {
      flush();
      const items = ['<ol>\n'];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push('<li>' + renderInline(lines[i].replace(/^\d+\. /, '')) + '</li>\n');
        i++;
      }
      items.push('</ol>\n');
      out.push(items.join(''));
      continue;
    }
    if (line.startsWith('>')) {
      flush();
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      out.push('<blockquote>\n' + renderMarkdown(buf.join('\n')) + '</blockquote>\n');
      continue;
    }
    if (line === '---' || line === '***' || line === '___' || line === '- - -') {
      flush();
      out.push('<hr>\n');
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join('');
}

function lookup(ctx, path) {
  if (path === 'this' || path === '.') return ctx;
  let cur = ctx;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function renderTemplate(text, ctx, templates) {
  let out = text;
  // partials
  out = out.replace(/\{\{>\s*([^}]+?)\s*\}\}/g, (m, name) =>
    templates[name] !== undefined ? renderTemplate(templates[name], ctx, templates) : ''
  );
  // each blocks (non-nested assumption is wrong in general; loop until stable)
  let guard = 0;
  while (out.includes('{{#each') && guard++ < 50) {
    out = out.replace(
      /\{\{#each\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (m, path, body) => {
        const arr = lookup(ctx, path.trim());
        if (!Array.isArray(arr)) return '';
        return arr
          .map((item, idx) => {
            const child =
              item !== null && typeof item === 'object'
                ? Object.assign(Object.create(ctx), item, { this: item, '@index': idx })
                : Object.assign(Object.create(ctx), { this: item, '@index': idx });
            return renderTemplate(body, child, templates);
          })
          .join('');
      }
    );
  }
  // if blocks
  guard = 0;
  while (out.includes('{{#if') && guard++ < 50) {
    out = out.replace(
      /\{\{#if\s+([^}]+?)\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (m, path, then, els) => {
        const v = lookup(ctx, path.trim());
        return renderTemplate(v ? then : els || '', ctx, templates);
      }
    );
  }
  out = out.replace(/\{\{![^}]*\}\}/g, '');
  out = out.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (m, path) => {
    const v = lookup(ctx, path.trim());
    return v === undefined || v === null ? '' : String(v);
  });
  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, path) => {
    const v = lookup(ctx, path.trim());
    return v === undefined || v === null ? '' : esc(String(v));
  });
  return out;
}

function asMap(x) {
  if (!x) return {};
  if (Array.isArray(x)) {
    const o = {};
    for (const e of x) o[e.name ?? e.path] = e.content ?? e.text ?? '';
    return o;
  }
  if (x instanceof Map) return Object.fromEntries(x);
  return x;
}

export function run(input) {
  const site = input.site || {};
  const templates = asMap(input.templates);
  const files = asMap(input.files);
  const pages = [];
  const statics = [];
  for (const path of Object.keys(files)) {
    const text = files[path];
    if (path.endsWith('.md') || path.endsWith('.markdown')) {
      const [meta, body] = parseFrontMatter(text);
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
        content: renderMarkdown(body),
        source: path,
      });
    } else {
      statics.push([path, text]);
    }
  }
  pages.sort((a, b) =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.title < b.title ? -1 : 1
  );
  const out = {};
  for (const p of pages) {
    const ctx = {
      site, page: p, title: p.title, slug: p.slug, date: p.date,
      tags: p.tags, content: p.content, pages,
    };
    out[p.slug + '/index.html'] =
      templates[p.template] !== undefined ? renderTemplate(templates[p.template], ctx, templates) : p.content;
  }
  const indexCtx = { site, pages, title: site.title || '' };
  out['index.html'] =
    templates['index'] !== undefined
      ? renderTemplate(templates['index'], indexCtx, templates)
      : '<!doctype html>\n<title>' + esc(String(site.title || '')) + '</title>\n' +
        pages.map((p) => '<a href="' + p.slug + '/">' + esc(p.title) + '</a>\n').join('');
  const byTag = {};
  for (const p of pages) for (const t of p.tags) (byTag[t] = byTag[t] || []).push(p);
  const tagNames = Object.keys(byTag).sort();
  for (const t of tagNames) {
    const ts = slugify(t);
    const ctx = { site, tag: t, pages: byTag[t], title: t };
    out['tags/' + ts + '/index.html'] =
      templates['tag'] !== undefined
        ? renderTemplate(templates['tag'], ctx, templates)
        : '<!doctype html>\n<title>' + esc(t) + '</title>\n' +
          byTag[t].map((p) => '<a href="' + p.slug + '/">' + esc(p.title) + '</a>\n').join('');
  }
  statics.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [path, text] of statics) out[path] = text;
  const report = [];
  report.push('pages: ' + pages.length);
  report.push('tags: ' + tagNames.length);
  report.push('static: ' + statics.length);
  for (const p of Object.keys(out).sort()) report.push(p + ' ' + out[p].length);
  out['build-report.txt'] = report.join('\n') + '\n';
  return out;
}

export default { run };
