const fs = require('node:fs');
const yaml = require('C:/Users/huang/.dsh/profiles/desktop/node_modules/js-yaml');

const jsTag = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (d) => ({ jsExpr: d }) });
const schema = yaml.DEFAULT_SCHEMA.extend([jsTag]);

const doc = yaml.load(fs.readFileSync(process.argv[2], 'utf8'), { schema });
const out = doc.map((block) => {
  const row = block.insert[0];
  if (row.config === undefined) {
    return { rowId: row.id, plugin: row.name, preset: false };
  }
  return {
    rowId: row.id,
    presetId: row.config.id,
    name: row.config.name,
    order: row.config.order,
    plugins: row.config.plugins.length,
  };
});
console.log(JSON.stringify(out, null, 2));