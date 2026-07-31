import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface TableNameRow {
  name: string;
}

interface ColumnRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface CountRow {
  count: number;
}

const suppliedPath = process.argv[2];
if (suppliedPath === undefined) {
  console.error('usage: npm run legacy:inspect -- path/to/database.db');
  process.exitCode = 1;
} else {
  const databasePath = resolve(suppliedPath);
  if (!existsSync(databasePath)) {
    console.error(`legacy database does not exist: ${databasePath}`);
    process.exitCode = 1;
  } else {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as unknown as TableNameRow[];
      console.info(`database: ${databasePath}`);
      for (const table of tables) {
        const columns = database
          .prepare(
            'SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY cid',
          )
          .all(table.name) as unknown as ColumnRow[];
        const safeTableName = table.name.replaceAll('"', '""');
        const count = database
          .prepare(`SELECT COUNT(*) AS count FROM "${safeTableName}"`)
          .get() as unknown as CountRow;
        console.info(`\n${table.name} (${count.count} rows)`);
        for (const column of columns) {
          const nullable = column.notnull === 0 ? 'nullable' : 'required';
          const primaryKey = column.pk === 0 ? '' : ' primary key';
          const defaultValue = column.dflt_value === null ? '' : ` default ${column.dflt_value}`;
          console.info(
            `  ${column.name}: ${column.type || 'untyped'} ${nullable}${primaryKey}${defaultValue}`,
          );
        }
      }
    } finally {
      database.close();
    }
  }
}
