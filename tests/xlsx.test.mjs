import test from "node:test";
import assert from "node:assert/strict";
import { buildXLSX } from "../app/js/xlsx.js";
import { toCSV, parseCSV } from "../app/js/util.js";

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Lê um ZIP store-only gerado pelo projeto e valida CRC de cada entrada. */
function readStoreZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let off = 0;
  const dec = new TextDecoder();
  while (off + 4 <= bytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const crc = dv.getUint32(off + 14, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = dec.decode(bytes.slice(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extraLen;
    const data = bytes.slice(start, start + size);
    assert.equal(crc32(data), crc, `CRC inválido em ${name}`);
    files[name] = data;
    off = start + size;
  }
  return files;
}

test("XLSX é um ZIP válido com workbook, estilos e abas", async () => {
  const blob = buildXLSX([
    {
      name: "Resumo",
      columns: [{ header: "Indicador", width: 30 }, { header: "Valor", width: 20, type: "money" }],
      rows: [["Spend", 1234.56], ["Fornecedor", "A & B <Ltda>"]],
    },
    {
      name: "Pedidos",
      columns: [{ header: "Pedido", width: 16 }, { header: "OTIF", width: 8, type: "int" }],
      rows: [["PO-1", 1]],
    },
  ]);
  const files = readStoreZip(new Uint8Array(await blob.arrayBuffer()));
  for (const name of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    assert.ok(files[name], `entrada ausente: ${name}`);
  }
  const workbook = new TextDecoder().decode(files["xl/workbook.xml"]);
  assert.match(workbook, /Resumo/);
  assert.match(workbook, /Pedidos/);
  const sheet = new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /A &amp; B &lt;Ltda&gt;/);
  assert.match(sheet, /1234\.56/);
});

test("CSV do projeto escapa aspas, separador e quebra de linha", () => {
  const text = toCSV(["nome", "obs"], [["A;B", 'diz "oi"'], ["C", "linha1\nlinha2"]]);
  assert.match(text, /"A;B"/);
  assert.match(text, /"diz ""oi"""/);
  const parsed = parseCSV(text);
  assert.equal(parsed.rows[0][0], "A;B");
  assert.equal(parsed.rows[0][1], 'diz "oi"');
  assert.equal(parsed.rows[1][1], "linha1\nlinha2");
});
