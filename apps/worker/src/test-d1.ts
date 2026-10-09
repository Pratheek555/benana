import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
class TestStatement {
  private values: SQLInputValue[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: SQLInputValue[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return (
      (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null
    );
  }
  all<T>() {
    return {
      results: this.db.prepare(this.sql).all(...this.values) as T[],
      success: true,
      meta: {},
    };
  }
  run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
      results: [],
    };
  }
}
export function createTestD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_github_auth.sql", "utf8"));
  db.exec(readFileSync("migrations/0002_refresh_owner.sql", "utf8"));
  return {
    prepare: (sql: string) => new TestStatement(db, sql),
    batch: async (statements: TestStatement[]) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
