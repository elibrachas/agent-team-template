// Smoke test del guard (sin DB): node guard.test.mjs
import assert from "node:assert/strict";
import { checkReadOnlySql } from "./guard.mjs";

const allow = [
  "select count(*) from users where is_staff = 0",
  "SELECT date(created_at) d, count(*) n FROM companies WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 1;",
  "with s as (select instance_id, min(created_at) t from instance_events where type = 'payment.received' group by 1) select count(*) from s",
  "select type, count(*) from mail_events where type = 'email.delivered' group by type",
  "select count(*) from users where email_verified_at is not null",
  "select replace(source, 'utm_', '') s, count(*) from companies group by 1",
  "select p.code, count(i.id) from instances i join plans p on p.id = i.plan_id group by p.code",
  "show tables",
  "describe instances",
  "explain select id from instances",
  "select id, updated_at, created_at from instances -- trae email? no: es un comentario",
  "select count(*) from plans /* comentario común: se ignora */",
  // columnas JSON (p. ej. un `source` con la atribución): el operador ->> tiene que pasar
  "select coalesce(source->>'$.utm_source', '(sin tag)') as canal, count(*) as n from companies group by 1",
  "select count(*) from free_accounts where source->>'$.utm_source' = 'acme-newsletter'",
  "select 5 - -1 as x",
];
const deny = [
  ["delete from users", /lectura/i],
  ["update users set is_staff = 1", /lectura/i],
  ["select 1; drop table users", /sola sentencia/i],
  ["select * from users", /columnas explícitamente/i],
  ["select u.* from users u", /columnas explícitamente/i],
  ["select id, email from users", /bloqueada/i],
  ["select id, `billing_email` from companies", /bloqueada/i],
  ["select db_password from instances", /bloqueada/i],
  ["select id into outfile '/tmp/x' from users", /INTO|OUTFILE/i],
  ["select sleep(10)", /SLEEP/i],
  ["with x as (select 1) delete from users", /DELETE/i],
  ["select id from users for share", /lock/i],
  ["", /vacío/i],
  // MySQL EJECUTA los comentarios /*! */ y los hints /*+ */
  ["select 1 /*!50000 , sleep(30) */", /ejecutables/i],
  ["select id from users /*!50000 into outfile '/tmp/x' */", /ejecutables/i],
  ["select /*+ MAX_EXECUTION_TIME(1) */ id from plans", /ejecutables/i],
  // `--` sin espacio NO es comentario en MySQL: `1 --1` es aritmética y lo que sigue se ejecuta
  ["select 1 --1, sleep(5)", /SLEEP/i],
  ["select id --x\n from users where 1 --1, email", /SLEEP|bloqueada/i],
];
for (const q of allow) {
  const r = checkReadOnlySql(q);
  assert.equal(r.ok, true, `debería permitir: ${q} → ${r.reason}`);
}
for (const [q, re] of deny) {
  const r = checkReadOnlySql(q);
  assert.equal(r.ok, false, `debería rechazar: ${q}`);
  assert.match(r.reason, re, `motivo inesperado para: ${q} → ${r.reason}`);
}
// el SQL que se ejecuta es el original (con literales), no el stripeado
assert.equal(checkReadOnlySql("select count(*) from mail_events where type = 'email.bounced';").sql,
  "select count(*) from mail_events where type = 'email.bounced'");
console.log(`guard OK — ${allow.length} permitidas, ${deny.length} rechazadas`);
