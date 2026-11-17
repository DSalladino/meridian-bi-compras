/* Administração de usuários e auditoria (somente papel admin). */
import { store } from "./data.js";
import { esc, toast } from "./util.js";

const PAPEIS = [
  ["admin", "Administrador"],
  ["analista", "Analista"],
  ["comprador", "Comprador"],
  ["leitor", "Leitor"],
];

const podeAdministrar = () => store.api && store.usuario?.papel === "admin";

function header(title, sub, action = "") {
  return `<div class="card-head"><div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>
    <div class="spacer"></div><div class="card-tools">${action}</div></div>`;
}

export function renderAdmin() {
  if (!podeAdministrar()) {
    return `<div class="card empty-state"><div class="empty-ico">⌁</div>
      <h3>Administração indisponível</h3>
      <p>Esta página existe apenas no servidor de produção e exige o papel <strong>Administrador</strong>.</p>
      <div class="tiny muted">No dataset demo não há login; rode <span class="mono">npm run start:prod</span> para usar usuários e auditoria.</div>
    </div>`;
  }
  return `<div class="admin-root" id="admin-root">
    <div class="card col-12" id="admin-usuarios">
      ${header("Usuários", "Papéis, escopo de dados e acesso", `<button class="btn btn-sm btn-primary" data-admin="novo">Novo usuário</button><button class="btn btn-sm btn-ghost" data-admin="recarregar">Atualizar</button>`)}
      <div id="admin-form-wrap" style="display:none"></div>
      <div id="admin-users-body"><div class="empty">Carregando usuários…</div></div>
    </div>
    <div class="card col-12" id="admin-auditoria">
      ${header("Auditoria", "Login, importações, exportações e alterações de acesso", `<button class="btn btn-sm btn-ghost" data-admin="recarregar">Atualizar</button>`)}
      <div id="admin-audit-body"><div class="empty">Carregando eventos…</div></div>
    </div>
  </div>`;
}

function formNovo() {
  return `<form class="admin-form" id="admin-novo-form">
    <div class="form-row"><div><label for="nu-usuario">Usuário</label><input id="nu-usuario" name="usuario" required minlength="3" maxlength="40" placeholder="ana.silva" /></div>
      <div><label for="nu-nome">Nome</label><input id="nu-nome" name="nome" required maxlength="120" placeholder="Ana Silva" /></div>
      <div><label for="nu-papel">Papel</label><select id="nu-papel" name="papel">${PAPEIS.map(([v, l]) => `<option value="${v}" ${v === "leitor" ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <div class="form-row"><div><label for="nu-senha">Senha (opcional; se vazia, é gerada)</label><input id="nu-senha" name="senha" type="password" minlength="8" autocomplete="new-password" /></div>
      <div><label for="nu-unidades">Unidades (separadas por vírgula)</label><input id="nu-unidades" name="unidades" placeholder="U1,U2" /></div>
      <div><label for="nu-categorias">Categorias</label><input id="nu-categorias" name="categorias" placeholder="K1,K2" /></div>
      <div><label for="nu-fornecedores">Fornecedores</label><input id="nu-fornecedores" name="fornecedores" placeholder="F001" /></div></div>
    <div class="admin-form-actions">
      <button class="btn btn-sm btn-primary" type="submit">Criar usuário</button>
      <button class="btn btn-sm btn-ghost" type="button" data-admin="cancelar">Cancelar</button>
      <span class="tiny muted">O escopo vazio significa acesso global. Senhas nunca são exibidas novamente.</span>
    </div>
  </form>`;
}

function tabelaUsuarios(usuarios) {
  if (!usuarios.length) return `<div class="empty">Nenhum usuário cadastrado.</div>`;
  const rows = usuarios.map((u) => {
    const escopo = u.escopo
      ? [u.escopo.unidades?.length ? `U: ${u.escopo.unidades.join(", ")}` : "", u.escopo.categorias?.length ? `C: ${u.escopo.categorias.join(", ")}` : "", u.escopo.fornecedores?.length ? `F: ${u.escopo.fornecedores.join(", ")}` : ""].filter(Boolean).join(" · ")
      : "global";
    const acoes = [
      `<button class="btn btn-sm btn-ghost" data-admin="editar" data-usuario="${esc(u.usuario)}">Editar</button>`,
      u.origem === "sso" ? "" : `<button class="btn btn-sm btn-ghost" data-admin="senha" data-usuario="${esc(u.usuario)}">Senha</button>`,
      `<button class="btn btn-sm btn-ghost" data-admin="alternar" data-usuario="${esc(u.usuario)}" data-ativo="${u.ativo ? "1" : "0"}">${u.ativo ? "Desativar" : "Ativar"}</button>`,
      `<button class="btn btn-sm btn-ghost danger" data-admin="excluir" data-usuario="${esc(u.usuario)}">Excluir</button>`,
    ].filter(Boolean).join(" ");
    return `<tr>
      <td><div class="name-cell"><strong>${esc(u.nome || u.usuario)}</strong><span class="tiny muted mono">${esc(u.usuario)}</span></div></td>
      <td>${esc(PAPEIS.find(([v]) => v === u.papel)?.[1] || u.papel)}</td>
      <td>${u.origem === "sso" ? `<span class="badge sky">SSO</span>` : `<span class="badge">local</span>`}</td>
      <td><span class="badge ${u.ativo ? "mint" : "blush"}">${u.ativo ? "ativo" : "inativo"}</span></td>
      <td class="tiny">${esc(escopo)}</td>
      <td class="admin-actions">${acoes}</td>
    </tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>
    <th>Usuário</th><th>Papel</th><th>Origem</th><th>Status</th><th>Escopo</th><th>Ações</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tabelaAuditoria(eventos) {
  if (!eventos.length) return `<div class="empty">Nenhum evento registrado.</div>`;
  const rows = eventos.map((e) => {
    const quando = e.ts ? new Date(e.ts).toLocaleString("pt-BR") : "—";
    const cls = /falha|bloqueado|rejeitada|removido/i.test(e.acao) ? "blush" : /exportacao|importacao/i.test(e.acao) ? "sky" : "mint";
    return `<tr>
      <td class="tiny mono">${esc(quando)}</td>
      <td><span class="badge ${cls}">${esc(e.acao || "—")}</span></td>
      <td class="tiny">${esc(e.usuario || "—")}${e.papel ? ` <span class="muted">(${esc(e.papel)})</span>` : ""}</td>
      <td class="tiny mono">${esc(String(e.detalhe || "").slice(0, 220))}</td>
      <td class="tiny muted">${esc(e.ip || "—")}</td>
    </tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>
    <th>Quando</th><th>Ação</th><th>Usuário</th><th>Detalhe</th><th>IP</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function api(rota, opts = {}) {
  const res = await fetch(`../${rota}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.erro || `Falha (${res.status}).`);
  return body;
}

function corpoUsuario(usuario) {
  const dados = usuario;
  return {
    nome: dados.nome,
    papel: dados.papel,
    ativo: dados.ativo,
    escopo: {
      unidades: String(dados.unidades || "").split(",").map((s) => s.trim()).filter(Boolean),
      categorias: String(dados.categorias || "").split(",").map((s) => s.trim()).filter(Boolean),
      fornecedores: String(dados.fornecedores || "").split(",").map((s) => s.trim()).filter(Boolean),
    },
  };
}

function formEdicao(u) {
  return `<form class="admin-form" id="admin-editar-form" data-usuario="${esc(u.usuario)}">
    <div class="form-row"><div><label>Usuário</label><input value="${esc(u.usuario)}" disabled /></div>
      <div><label for="eu-nome">Nome</label><input id="eu-nome" name="nome" value="${esc(u.nome || "")}" maxlength="120" /></div>
      <div><label for="eu-papel">Papel</label><select id="eu-papel" name="papel">${PAPEIS.map(([v, l]) => `<option value="${v}" ${v === u.papel ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <div class="form-row"><div><label for="eu-unidades">Unidades</label><input id="eu-unidades" name="unidades" value="${esc((u.escopo?.unidades || []).join(","))}" placeholder="U1,U2" /></div>
      <div><label for="eu-categorias">Categorias</label><input id="eu-categorias" name="categorias" value="${esc((u.escopo?.categorias || []).join(","))}" placeholder="K1" /></div>
      <div><label for="eu-fornecedores">Fornecedores</label><input id="eu-fornecedores" name="fornecedores" value="${esc((u.escopo?.fornecedores || []).join(","))}" placeholder="F001" /></div></div>
    <div class="admin-form-actions">
      <button class="btn btn-sm btn-primary" type="submit">Salvar</button>
      <button class="btn btn-sm btn-ghost" type="button" data-admin="cancelar">Cancelar</button>
    </div>
  </form>`;
}

async function carregar() {
  const root = document.getElementById("admin-root");
  if (!root) return;
  try {
    const [users, audit] = await Promise.all([
      api("api/usuarios"),
      api("api/audit?limite=80"),
    ]);
    const usersBody = document.getElementById("admin-users-body");
    if (usersBody) usersBody.innerHTML = tabelaUsuarios(users.usuarios || []);
    const auditBody = document.getElementById("admin-audit-body");
    if (auditBody) auditBody.innerHTML = tabelaAuditoria(audit.eventos || []);
    root.dataset.usuarios = JSON.stringify(users.usuarios || []);
    root.dataset.auditoria = JSON.stringify(audit.eventos || []);
  } catch (err) {
    const usersBody = document.getElementById("admin-users-body");
    if (usersBody) usersBody.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`;
    if (err.message.includes("401")) window.location.href = "../login.html?erro=sessao";
  }
}

function usuarioPorNome(nome) {
  try {
    return JSON.parse(document.getElementById("admin-root")?.dataset.usuarios || "[]")
      .find((u) => u.usuario === nome);
  } catch {
    return null;
  }
}

let bound = false;

export async function initAdmin() {
  if (!podeAdministrar()) return;
  if (!bound) {
    bound = true;
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-admin]");
      if (!btn || !document.getElementById("admin-root")) return;
      const acao = btn.dataset.admin;
      const nome = btn.dataset.usuario;
      const wrap = document.getElementById("admin-form-wrap");
      if (acao === "novo") {
        if (wrap) { wrap.style.display = ""; wrap.innerHTML = formNovo(); }
      }
      if (acao === "cancelar") {
        if (wrap) { wrap.style.display = "none"; wrap.innerHTML = ""; }
      }
      if (acao === "recarregar") {
        await carregar();
        toast("Dados administrativos atualizados.", "good");
      }
      if (acao === "editar") {
        const u = usuarioPorNome(nome);
        if (wrap && u) { wrap.style.display = ""; wrap.innerHTML = formEdicao(u); }
      }
      if (acao === "senha") {
        const senha = window.prompt(`Nova senha para ${nome} (mínimo 8 caracteres):`);
        if (!senha) return;
        try {
          await api(`api/usuarios/${encodeURIComponent(nome)}`, { method: "PATCH", body: JSON.stringify({ senha }) });
          toast(`Senha de ${nome} atualizada; sessões antigas foram invalidadas.`, "good");
          await carregar();
        } catch (err) { toast(err.message, "bad"); }
      }
      if (acao === "alternar") {
        const ativo = btn.dataset.ativo === "1";
        if (ativo && !window.confirm(`Desativar ${nome}? As sessões ativas serão encerradas.`)) return;
        try {
          await api(`api/usuarios/${encodeURIComponent(nome)}`, { method: "PATCH", body: JSON.stringify({ ativo: !ativo }) });
          toast(`${nome} ${ativo ? "desativado" : "ativado"}.`, "good");
          await carregar();
        } catch (err) { toast(err.message, "bad"); }
      }
      if (acao === "excluir") {
        if (!window.confirm(`Excluir definitivamente ${nome}? O histórico de auditoria é preservado.`)) return;
        try {
          await api(`api/usuarios/${encodeURIComponent(nome)}`, { method: "DELETE" });
          toast(`${nome} removido.`, "good");
          await carregar();
        } catch (err) { toast(err.message, "bad"); }
      }
    });

    document.addEventListener("submit", async (e) => {
      const novo = e.target.closest("#admin-novo-form");
      const editar = e.target.closest("#admin-editar-form");
      if (!novo && !editar) return;
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        if (novo) {
          const body = {
            usuario: fd.get("usuario"),
            nome: fd.get("nome"),
            papel: fd.get("papel"),
            senha: fd.get("senha") || undefined,
            escopo: corpoUsuario(Object.fromEntries(fd)).escopo,
          };
          const res = await api("api/usuarios", { method: "POST", body: JSON.stringify(body) });
          const el = document.getElementById("admin-form-wrap");
          if (el) {
            el.innerHTML = `<div class="notice good">Usuário <strong>${esc(body.usuario)}</strong> criado.
              ${res.senhaGerada ? `Senha inicial (copie agora): <span class="mono">${esc(res.senhaGerada)}</span>` : ""}</div>`;
          }
          await carregar();
        } else {
          const nome = editar.dataset.usuario;
          const escopo = corpoUsuario(Object.fromEntries(fd)).escopo;
          await api(`api/usuarios/${encodeURIComponent(nome)}`, {
            method: "PATCH",
            body: JSON.stringify({ nome: fd.get("nome"), papel: fd.get("papel"), escopo }),
          });
          toast("Usuário atualizado.", "good");
          const wrap = document.getElementById("admin-form-wrap");
          if (wrap) { wrap.style.display = "none"; wrap.innerHTML = ""; }
          await carregar();
        }
      } catch (err) {
        toast(err.message, "bad");
      }
    });
  }
  await carregar();
}

