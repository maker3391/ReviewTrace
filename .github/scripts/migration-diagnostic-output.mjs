/** 운영 log에 남겨도 되는 PostgreSQL migration 실패 정보만 만든다. */

const CATEGORY_BY_CLASS = new Map([
  ["08", "connection_exception"],
  ["22", "data_exception"],
  ["23", "integrity_constraint_violation"],
  ["25", "invalid_transaction_state"],
  ["28", "invalid_authorization"],
  ["40", "transaction_rollback"],
  ["42", "syntax_or_access_rule_violation"],
  ["53", "insufficient_resources"],
  ["55", "object_not_in_prerequisite_state"],
  ["57", "operator_intervention"],
]);

const STATEMENT_KINDS = [
  "ALTER TABLE",
  "CREATE INDEX",
  "CREATE UNIQUE INDEX",
  "CREATE TABLE",
  "CREATE TYPE",
  "DELETE",
  "DROP INDEX",
  "DROP TABLE",
  "DROP TYPE",
  "INSERT",
  "UPDATE",
];

function safeSqlState(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
    ? code
    : "UNKNOWN";
}

function statementKind(statement) {
  const normalized = statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return (
    STATEMENT_KINDS.find(
      (kind) => normalized === kind || normalized.startsWith(`${kind} `),
    ) ?? "OTHER"
  );
}

export function formatMigrationFailure(failed) {
  const code = safeSqlState(failed.error);
  const category =
    code === "UNKNOWN"
      ? "postgres_error"
      : (CATEGORY_BY_CLASS.get(code.slice(0, 2)) ?? "postgres_error");

  return [
    `🔴 실패: ${failed.tag} — ${failed.index}/${failed.total} 번째 문장`,
    "",
    `  code      : ${code}`,
    `  category  : ${category}`,
    `  statement : ${statementKind(failed.statement)}`,
  ];
}
