#!/usr/bin/env node
/**
 * Administração de usuários do servidor de produção.
 *
 * Uso:
 *   node scripts/usuarios.mjs criar --usuario ana --nome "Ana Silva" --papel analista
 *   node scripts/usuarios.mjs listar
 *   node scripts/usuarios.mjs senha --usuario ana
 *   node scripts/usuarios.mjs desativar --usuario ana
 *   node scripts/usuarios.mjs escopo --usuario ana --unidades U1 --categorias K1,K2
 *   node scripts/usuarios.mjs remover --usuario ana
 *
 * Papéis: admin (administra), analista/comprador (importam), leitor (consulta).
 * Sem --senha, uma senha aleatória é gerada e impressa uma única vez.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PAPEIS, carregarUsuarios, salvarUsuarios, hashPassword } from "../server/auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
};
const file = path.resolve(ROOT, flag("arquivo") || "config/usuarios.json");

function usage(code = 0) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace("/**", "").trim());
  process.exit(code);
}

function senhaNova() {
  const informada = flag("senha");
  if (typeof informada === "string" && informada.length) return { senha: informada, gerada: false };
  const gerada = crypto.randomBytes(9).toString("base64url");
  return { senha: gerada, gerada: true };
}

function lista() {
  const usuarios = carregarUsuarios(file);
  if (!usuarios.length) {
    console.log(`  Nenhum usuário em ${path.relative(ROOT, file)}.`);
    return usuarios;
  }
  console.log(`\n  ${path.relative(ROOT, file)}\n`);
  for (const u of usuarios) {
    const escopo = u.escopo
      ? [u.escopo.unidades?.length ? `unidades=${u.escopo.unidades.join(",")}` : "", u.escopo.categorias?.length ? `categorias=${u.escopo.categorias.join(",")}` : ""].filter(Boolean).join(" ")
      : "global";
    console.log(`  ${u.usuario.padEnd(18)} ${String(u.nome || "").padEnd(26)} ${String(u.papel).padEnd(10)} ${u.ativo === false ? "inativo" : "ativo"}  ${escopo}`);
  }
  console.log("");
  return usuarios;
}

const usuarios = carregarUsuarios(file);
const alvo = typeof flag("usuario") === "string" ? flag("usuario") : "";

if (!cmd || cmd === "ajuda" || cmd === "help" || cmd === "--help") usage(cmd ? 0 : 1);

function adminsAtivos(lista) {
  return lista.filter((u) => u.papel === "admin" && u.ativo !== false);
}

function garantirAdmin(lista, acao) {
  if (adminsAtivos(lista).length === 0) {
    console.error(`  ✗ ${acao} deixaria a instalação sem administrador ativo.`);
    process.exit(1);
  }
}

if (cmd === "criar") {
  if (!alvo) { console.error("  ✗ informe --usuario"); process.exit(1); }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(alvo)) { console.error("  ✗ usuário deve ter 3–40 caracteres (letras, números, . _ -)."); process.exit(1); }
  if (usuarios.some((u) => u.usuario === alvo)) { console.error(`  ✗ usuário ${alvo} já existe`); process.exit(1); }
  const papel = String(flag("papel") || "leitor");
  if (!PAPEIS[papel]) { console.error(`  ✗ papel inválido. Use: ${Object.keys(PAPEIS).join(", ")}`); process.exit(1); }
  const { senha, gerada } = senhaNova();
  const { salt, hash } = hashPassword(senha);
  usuarios.push({
    usuario: alvo,
    nome: String(flag("nome") || alvo),
    papel,
    ativo: true,
    salt, hash,
    criadoEm: new Date().toISOString(),
  });
  salvarUsuarios(file, usuarios);
  console.log(`  ▸ usuário ${alvo} criado como ${PAPEIS[papel].label}.`);
  if (gerada) console.log(`  ▸ senha gerada (guarde agora, não será exibida de novo): ${senha}`);
  process.exit(0);
}

if (cmd === "listar") { lista(); process.exit(0); }

if (!alvo) { console.error("  ✗ informe --usuario"); process.exit(1); }
const idx = usuarios.findIndex((u) => u.usuario === alvo);
if (idx < 0) { console.error(`  ✗ usuário ${alvo} não encontrado`); process.exit(1); }

if (cmd === "senha") {
  const { senha, gerada } = senhaNova();
  Object.assign(usuarios[idx], hashPassword(senha), {
    senhaTrocadaEm: new Date().toISOString(),
    sessionVersion: Number(usuarios[idx].sessionVersion || 0) + 1,
  });
  salvarUsuarios(file, usuarios);
  console.log(`  ▸ senha de ${alvo} atualizada.`);
  if (gerada) console.log(`  ▸ senha gerada: ${senha}`);
} else if (cmd === "ativar" || cmd === "desativar") {
  if (cmd === "desativar" && usuarios[idx].papel === "admin") {
    const restantes = usuarios.filter((u, i) => i !== idx);
    garantirAdmin(restantes, "desativar este administrador");
  }
  usuarios[idx].ativo = cmd === "ativar";
  salvarUsuarios(file, usuarios);
  console.log(`  ▸ ${alvo} ${usuarios[idx].ativo ? "ativado" : "desativado"}.`);
} else if (cmd === "papel") {
  const papel = String(flag("papel") || "");
  if (!PAPEIS[papel]) { console.error(`  ✗ papel inválido. Use: ${Object.keys(PAPEIS).join(", ")}`); process.exit(1); }
  if (usuarios[idx].papel === "admin" && papel !== "admin") {
    garantirAdmin(usuarios.filter((u, i) => i !== idx), "mudar o papel deste administrador");
  }
  usuarios[idx].papel = papel;
  salvarUsuarios(file, usuarios);
  console.log(`  ▸ ${alvo} agora é ${PAPEIS[papel].label}.`);
} else if (cmd === "escopo") {
  const unidades = String(flag("unidades") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const categorias = String(flag("categorias") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const fornecedores = String(flag("fornecedores") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!unidades.length && !categorias.length && !fornecedores.length) {
    delete usuarios[idx].escopo;
    console.log(`  ▸ ${alvo} agora tem escopo global.`);
  } else {
    usuarios[idx].escopo = { unidades, categorias, fornecedores };
    console.log(`  ▸ escopo de ${alvo}: ${JSON.stringify(usuarios[idx].escopo)}`);
  }
  salvarUsuarios(file, usuarios);
} else if (cmd === "remover") {
  if (usuarios[idx].papel === "admin") garantirAdmin(usuarios.filter((u, i) => i !== idx), "remover este administrador");
  usuarios.splice(idx, 1);
  salvarUsuarios(file, usuarios);
  console.log(`  ▸ usuário ${alvo} removido.`);
} else {
  console.error(`  ✗ comando desconhecido: ${cmd}`);
  usage(1);
}

if (!fs.existsSync(file)) process.exit(1);
