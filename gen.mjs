// gen.mjs — deterministic synthetic case generator, shaped like the cases
// the bounty brief describes: one site { site, templates, files } with
// 200–600 Markdown sources, a few static files and 14–30 templates.
// Seeded PRNG: the same seed always makes the same case.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'alpha', 'beta', 'gamma', 'delta', 'harbor', 'meadow', 'quartz', 'velvet',
  'cinder', 'orbit', 'lantern', 'mosaic', 'prairie', 'saffron', 'timber',
  'willow', 'zephyr', 'cobalt', 'dune', 'ember', 'fjord', 'glacier', 'heron',
  'inkwell', 'juniper', 'kepler', 'lagoon', 'magnet', 'nectar', 'onyx',
  'pepper', 'quiver', 'riddle', 'sable', 'tundra', 'umbra', 'violet',
  'walnut', 'xenon', 'yonder', 'zenith',
];
const TAGS = ['news', 'guide', 'release', 'notes', 'essay', 'tutorial', 'Café Life', 'Über Tech', 'field-notes', 'deep dive'];
const TITLES_EXTRA = ['Café Notes', 'Über Alles Testing', 'Naïve Approaches', 'Résumé of a Build'];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function makeBody(rng, title) {
  const parts = [];
  parts.push('# ' + title + '\n');
  const paras = 3 + Math.floor(rng() * 4);
  for (let p = 0; p < paras; p++) {
    const kind = rng();
    if (kind < 0.45) {
      const words = [];
      const count = 12 + Math.floor(rng() * 20);
      for (let w = 0; w < count; w++) words.push(pick(rng, WORDS));
      let sentence = words.join(' ');
      if (rng() < 0.6) {
        sentence += ' with **bold ' + pick(rng, WORDS) + '** and *light ' + pick(rng, WORDS) + '*';
      }
      if (rng() < 0.5) {
        sentence += ' plus a [link to ' + pick(rng, WORDS) + '](https://example.com/' + pick(rng, WORDS) + ')';
      }
      if (rng() < 0.4) {
        sentence += ' and `code ' + pick(rng, WORDS) + '` inline';
      }
      parts.push(sentence + '.\n');
    } else if (kind < 0.6) {
      const items = [];
      const count = 3 + Math.floor(rng() * 4);
      for (let k = 0; k < count; k++) items.push('- item ' + pick(rng, WORDS) + ' ' + pick(rng, WORDS));
      parts.push(items.join('\n') + '\n');
    } else if (kind < 0.72) {
      const items = [];
      const count = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < count; k++) items.push((k + 1) + '. step ' + pick(rng, WORDS));
      parts.push(items.join('\n') + '\n');
    } else if (kind < 0.84) {
      parts.push('## Section ' + pick(rng, WORDS) + '\n');
      parts.push('Some text under the section about ' + pick(rng, WORDS) + ' and ' + pick(rng, WORDS) + '.\n');
    } else if (kind < 0.92) {
      parts.push('> quoted ' + pick(rng, WORDS) + ' line\n> second ' + pick(rng, WORDS) + ' line\n');
    } else {
      parts.push('```\nconst ' + pick(rng, WORDS) + ' = ' + Math.floor(rng() * 1000) + ';\nconsole.log(' + pick(rng, WORDS) + ');\n```\n');
    }
  }
  return parts.join('\n');
}

export function makeCase(seed, pageCount) {
  const rng = mulberry32(seed);
  const files = {};
  const usedTitles = new Set();
  for (let i = 0; i < pageCount; i++) {
    let title;
    if (i % 97 === 50) title = pick(rng, TITLES_EXTRA) + ' ' + i;
    else {
      title = pick(rng, WORDS) + ' ' + pick(rng, WORDS) + ' ' + i;
      title = title[0].toUpperCase() + title.slice(1);
    }
    if (usedTitles.has(title)) title += ' again';
    usedTitles.add(title);
    const tagCount = Math.floor(rng() * 3);
    const tags = [];
    for (let t = 0; t < tagCount; t++) {
      const tag = pick(rng, TAGS);
      if (!tags.includes(tag)) tags.push(tag);
    }
    const fm = [
      '---',
      'title: ' + title,
      'date: 2026-11-' + String(1 + Math.floor(rng() * 22)).padStart(2, '0'),
      tags.length ? 'tags: [' + tags.join(', ') + ']' : null,
      rng() < 0.25 ? 'template: article' : null,
      '---',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');
    files['content/post-' + i + '.md'] = fm + makeBody(rng, title);
  }
  files['static/style.css'] = 'body { margin: 0; font-family: sans-serif; }\n';
  files['static/app.js'] = 'console.log("site");\n';
  files['static/robots.txt'] = 'User-agent: *\nAllow: /\n';

  const templates = {
    page:
      '<!doctype html>\n<html><head><title>{{title}} — {{site.title}}</title></head>' +
      '<body>{{> header}}<main>{{{content}}}</main>' +
      '<footer>{{#each tags}}<span>{{this}}</span>{{/each}}</footer></body></html>\n',
    article:
      '<!doctype html>\n<html><head><title>{{title}}</title></head>' +
      '<body>{{> header}}<article>{{{content}}}</article>' +
      '<p class="date">{{date}}</p></body></html>\n',
    index:
      '<!doctype html>\n<html><head><title>{{site.title}}</title></head><body>{{> header}}' +
      '<ul>{{#each pages}}<li><a href="{{slug}}/">{{title}}</a></li>{{/each}}</ul></body></html>\n',
    tag:
      '<!doctype html>\n<html><head><title>{{tag}} — {{site.title}}</title></head><body>' +
      '<h1>{{tag}}</h1><ul>{{#each pages}}<li><a href="{{slug}}/">{{title}}</a></li>{{/each}}</ul></body></html>\n',
    header: '<header>{{site.title}}</header>\n',
  };
  // Pad to a realistic 14–30 template count with extra partials/variants.
  for (let i = 0; i < 15; i++) {
    templates['partial-' + i] = '<div class="p' + i + '">{{site.title}}</div>\n';
  }

  return {
    site: { title: 'Benchmark Site', base: '/' },
    templates,
    files,
  };
}
