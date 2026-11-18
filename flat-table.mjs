// flat-table: a MyST port of the linuxdoc ``flat-table`` directive.
//
// A flat-table is a two-level bullet list like ``list-table`` with these additions:
//   {rspan}`n`  at the start of a cell: the cell spans n additional rows
//   {cspan}`n`  at the start of a cell: the cell spans n additional columns
//   The last cell of a short row spans the missing columns on its right
//   (auto-span); with the :fill-cells: option, empty cells are inserted instead.
//
// Options (as in linuxdoc): name, class, header-rows, stub-columns, width,
// widths, fill-cells, align.  An optional argument is the table title.

const SPAN_ROLES = ['rspan', 'cspan'];

const spanRole = (name) => ({
  name,
  doc: `Flat-table cell span: number of additional ${name === 'rspan' ? 'rows' : 'columns'}.`,
  body: { type: String, required: true },
  run(data) {
    return [{ type: 'flatTableSpan', kind: name, span: parseInt(String(data.body).trim(), 10) || 0 }];
  },
});

// A span marker is either our role output or an unresolved role node.
function spanOf(node) {
  if (node?.type === 'flatTableSpan') return { kind: node.kind, span: node.span };
  if (node?.type === 'mystRole' && SPAN_ROLES.includes(node.name)) {
    return { kind: node.name, span: parseInt(String(node.value).trim(), 10) || 0 };
  }
  return null;
}

// linuxdoc parseCellItem: remove rspan/cspan from the first element of the cell.
function parseCell(listItem) {
  let cspan = 0;
  let rspan = 0;
  const content = listItem.children ?? [];
  const first = content[0];
  if (first?.children) {
    const kept = [];
    let removed = false;
    for (const child of first.children) {
      const s = spanOf(child);
      if (s) {
        if (s.kind === 'rspan') rspan = s.span;
        else cspan = s.span;
        removed = true;
        continue;
      }
      kept.push(child);
    }
    if (removed) {
      // drop the blank that separated the span roles from the cell text
      while (kept[0]?.type === 'text' && kept[0].value.trim() === '') kept.shift();
      if (kept[0]?.type === 'text') kept[0] = { ...kept[0], value: kept[0].value.replace(/^\s+/, '') };
      first.children = kept;
    }
  }
  const children = first?.children && first.children.length === 0 ? content.slice(1) : content;
  return { cspan, rspan, children };
}

// linuxdoc roundOffTableDefinition
function roundOff(rows, fillCells) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const cell = rows[y][x];
      if (cell === null) continue;
      for (let c = 0; c < cell.cspan; c++) rows[y].splice(x + c + 1, 0, null);
      for (let r = 0; r < cell.rspan; r++) {
        const row = rows[y + r + 1];
        if (!row) continue; // the user sets ambiguous rowspans
        for (let c = 0; c <= cell.cspan; c++) row.splice(x + c, 0, null);
      }
    }
  }
  const maxCols = Math.max(0, ...rows.map((row) => row.length));
  for (const row of rows) {
    const missing = maxCols - row.length;
    if (!missing) continue;
    if (fillCells) {
      for (let i = 0; i < missing; i++) row.push({ cspan: 0, rspan: 0, children: [] });
    } else if (row[row.length - 1] === null) {
      row.push({ cspan: missing - 1, rspan: 0, children: [] });
    } else {
      row[row.length - 1].cspan += missing;
    }
  }
  return maxCols;
}

function parseWidths(value, maxCols, vfile, node) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (text === 'auto' || text === 'grid' || text === '') return undefined;
  const widths = text.split(/[\s,]+/).map((w) => parseInt(w, 10));
  if (widths.some((w) => !(w > 0)) || widths.length !== maxCols) {
    vfile.message(
      `flat-table: "${text}" must list ${maxCols} positive integers, one per column`,
      node,
    );
    return undefined;
  }
  const total = widths.reduce((a, b) => a + b, 0);
  return widths.map((w) => (100 * w) / total);
}

const flatTableDirective = {
  name: 'flat-table',
  doc: 'A list-table with row and column spans (port of linuxdoc flat-table).',
  arg: { type: 'myst', doc: 'An optional table title' },
  options: {
    label: { type: String, alias: ['name'] },
    class: { type: String },
    'header-rows': { type: Number },
    'stub-columns': { type: Number },
    width: { type: String },
    widths: { type: String },
    'fill-cells': { type: Boolean },
    align: { type: String },
  },
  body: { type: 'myst', required: true },
  run(data, vfile) {
    // Like linuxdoc: comments and targets are allowed on the row level.
    const body = (data.body ?? []).filter((n) => n.type !== 'comment');
    const list = body.length === 1 && body[0].type === 'list' ? body[0] : null;
    const rowParts = list?.children.map((rowItem) => {
      const kids = (rowItem.children ?? []).filter((n) => n.type !== 'comment');
      const lists = kids.filter((n) => n.type === 'list');
      const others = kids.filter((n) => n.type !== 'list' && n.type !== 'mystTarget');
      if (lists.length !== 1 || others.length) return null;
      return { cells: lists[0].children, targets: kids.filter((n) => n.type === 'mystTarget') };
    });
    if (!rowParts || rowParts.some((r) => r === null)) {
      vfile.message('flat-table: a two-level bullet list is expected', data.node);
      return [];
    }
    const opts = data.options ?? {};
    const rows = rowParts.map(({ cells, targets }) => {
      const row = cells.map(parseCell);
      if (targets.length && row[0]) row[0].children = [...targets, ...row[0].children];
      return row;
    });
    const maxCols = roundOff(rows, !!opts['fill-cells']);
    const colWidths = parseWidths(opts.widths, maxCols, vfile, data.node);
    const headerRows = opts['header-rows'] ?? 0;
    const stubColumns = opts['stub-columns'] ?? 0;

    const table = {
      type: 'table',
      align: opts.align,
      children: rows.map((row, y) => ({
        type: 'tableRow',
        children: row.flatMap((cell, x) => {
          if (cell === null) return [];
          const node = { type: 'tableCell', children: cell.children };
          if (y < headerRows || x < stubColumns) node.header = true;
          if (cell.rspan) node.rowspan = cell.rspan + 1;
          if (cell.cspan) node.colspan = cell.cspan + 1;
          if (colWidths) {
            const w = colWidths.slice(x, x + cell.cspan + 1).reduce((a, b) => a + b, 0);
            node.style = { width: `${Math.round(w * 100) / 100}%` };
          }
          return [node];
        }),
      })),
    };
    if (opts.width) table.style = { width: opts.width };

    const children = [];
    if (data.arg) children.push({ type: 'caption', children: [{ type: 'paragraph', children: data.arg }] });
    children.push(table);
    const container = { type: 'container', kind: 'table', children };
    if (opts.label) {
      container.label = opts.label;
      container.identifier = opts.label.trim().toLowerCase().replace(/\s+/g, '-');
    }
    if (opts.class) container.class = opts.class;
    if (!colWidths) return [container];
    // MyST's Typst export writes tables as tablex(columns: n, ..columnStyle, ...),
    // so set columnStyle to the column widths for this table and reset it after.
    const typstCols = colWidths.map((w) => `${Math.round(w * 100) / 100}%`).join(', ');
    return [
      { type: 'raw', typst: `#let columnStyle = (columns: (${typstCols},))\n` },
      container,
      { type: 'raw', typst: '#let columnStyle = (:)\n' },
    ];
  },
};

// Remove span markers used outside a flat-table (linuxdoc FlatTableProcessor).
const removeStraySpans = {
  name: 'flat-table-remove-stray-spans',
  stage: 'document',
  plugin: () => (tree) => {
    const walk = (node) => {
      if (!node.children) return;
      node.children = node.children.filter((child) => !spanOf(child));
      node.children.forEach(walk);
    };
    walk(tree);
  },
};

const plugin = {
  name: 'flat-table',
  directives: [flatTableDirective],
  roles: [spanRole('rspan'), spanRole('cspan')],
  transforms: [removeStraySpans],
};

export default plugin;
