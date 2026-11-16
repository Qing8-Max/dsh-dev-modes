const fs = require('node:fs');
const yaml = require('C:/Users/huang/.dsh/profiles/desktop/node_modules/js-yaml');

const jsTag = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (d) => ({ jsExpr: d }) });
const schema = yaml.DEFAULT_SCHEMA.extend([jsTag]);

const doc = yaml.load(fs.readFileSync(process.argv[2], 'utf8'), { schema });
const row = doc.find((r) => r && r.id === 'plugin-market');
console.log(JSON.stringify({
  rows: doc.length,
  ids: doc.map((r) => r && r.id),
  pluginMarket: row ? row.config : null,
}, null, 2));