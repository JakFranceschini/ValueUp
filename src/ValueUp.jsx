import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { initializeApp } from "@firebase/app";
import { getDatabase, ref, get, set } from "@firebase/database";
import ativosPadrao from "./data/ativos.json";
import proventosPadrao from "./data/proventos.json";
import evolucaoPadrao from "./data/evolucao.json";

const SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/1sSujoT_tUBA0bHWRpn0aDf59cGpU0tTg3AVzBnFgbUo/export?format=csv&gid=";

const SHEET_GIDS = {
  ativos: "0",
};

const LOCAL_STORAGE_KEY = "valueup_dados_locais";

const firebaseConfig = {
  apiKey: "AIzaSyA8VHVwap0jVh9zBbBKp27o2U7iQokKroI",
  authDomain: "valueup-d307f.firebaseapp.com",
  databaseURL: "https://valueup-d307f-default-rtdb.firebaseio.com",
  projectId: "valueup-d307f",
  storageBucket: "valueup-d307f.firebasestorage.app",
  messagingSenderId: "1799501680",
  appId: "1:1799501680:web:ec042228c63880f40941b5",
};

const SEED_ATIVOS_URL    = "/dados/ativos.json";
const SEED_PROVENTOS_URL = "/dados/proventos.json";
const SEED_EVOLUCAO_URL  = "/dados/evolucao.json";

function dadosLocaisPadrao() {
  return {
    ativos: { ...ativosPadrao },
    reserva_atual: 0,
    metas: { stocks: 0, reits: 0, acoes: 0, fiis: 0, etfs: 0, bitcoins: 0, reservas: 0 },
    proventos: [...proventosPadrao],

    evolucao: [...evolucaoPadrao],
  };
}

const CLASSES_ATIVOS = [
  { classe: "stock",   titulo: "Stocks",   sufixo: "stocks"   },
  { classe: "reit",    titulo: "Reits",    sufixo: "reits"    },
  { classe: "acao",    titulo: "Ações",    sufixo: "acoes"    },
  { classe: "fii",     titulo: "Fiis",     sufixo: "fiis"     },
  { classe: "etf",     titulo: "Etfs",     sufixo: "etfs"     },
  { classe: "bitcoin", titulo: "Bitcoins", sufixo: "bitcoins" },
];

const ALOCACAO_CLASSES = [
  ...CLASSES_ATIVOS.map(({ sufixo, titulo }) => ({ sufixo, titulo })),
  { sufixo: "reservas", titulo: "Reserva" },
];

const PAGINAS = [
  { id: "patrimonio",     titulo: "Patrimônio"    },
  { id: "investimentos",  titulo: "Investimentos" },
  { id: "cotacoes",       titulo: "Cotações"      },
  { id: "financas",       titulo: "Finanças"       },
];

const FILTROS = [
  { texto: "Nome",       key: "nome"                },
  { texto: "Total atual",key: "total_atual"         },
  { texto: "Variação",   key: "variacao_total"      },
  { texto: "Variação %", key: "variacao_percentual" },
  { texto: "% Atual",    key: "porcentagem_atual"   },
];

const COR_ALTA        = "#0a5550";
const COR_BAIXA       = "#8a3535";
const PALETA_ALOCACAO = ["#094945","#0b605b","#0e7771","#118d86","#13a49c","#16bdb4","#19d7cb"];

function toFloat(v) {
  const s = String(v ?? "0").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtBRL(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtUSD(v) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function formatarBRLInput(raw) {
  const digitos = String(raw ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  const centavos = parseInt(digitos, 10);
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseBRLInput(formatado) {
  const s = String(formatado ?? "").trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function formatarUSDInput(raw) {
  const digitos = String(raw ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  const centavos = parseInt(digitos, 10);
  return (centavos / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseUSDInput(formatado) {
  const s = String(formatado ?? "").trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function ehClasseEmDolar(classe) {
  return CLASSES_EM_DOLAR.includes(String(classe ?? "").toLowerCase().trim());
}

function formatarMoedaInput(raw, classe) {
  return ehClasseEmDolar(classe) ? formatarUSDInput(raw) : formatarBRLInput(raw);
}

function parseMoedaInput(formatado, classe) {
  return ehClasseEmDolar(classe) ? parseUSDInput(formatado) : parseBRLInput(formatado);
}

function sinal(v) { return v > 0 ? "+" : ""; }

function sinalCompleto(v) { return v > 0 ? "+" : v < 0 ? "-" : ""; }

function sentenceCase(str) {
  const s = String(str ?? "");
  const idx = s.search(/\p{L}/u);
  if (idx === -1) return s;
  return s.slice(0, idx) + s.charAt(idx).toUpperCase() + s.slice(idx + 1).toLowerCase();
}

function corVar(v) {
  if (v > 0) return COR_ALTA;
  if (v < 0) return COR_BAIXA;
  return "var(--color-neutral)";
}

function corHeatmap(pct) {

  if (pct >= 100) return "#063d3a";
  if (pct >= 50)  return "#0a5550";
  if (pct >= 20)  return "#0e7971";
  if (pct >= 0)   return "#16b8ae";

  if (pct >= -20) return "#c0504a";
  if (pct >= -50) return "#8a3535";
  return "#4f1f1f";
}

function calcularEvolucaoComDiferenca(evolucaoBase, totalPatrimonioAtual) {
  const anoAtual = String(new Date().getFullYear());

  const linhas = (evolucaoBase ?? [])
    .map(r => ({ ano: String(r.ano ?? "").trim(), valor: toFloat(r.valor) }))
    .filter(r => r.ano)
    .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));

  if (totalPatrimonioAtual != null) {
    const idxAtual = linhas.findIndex(r => r.ano === anoAtual);
    if (idxAtual >= 0) {
      linhas[idxAtual] = { ano: anoAtual, valor: totalPatrimonioAtual };
    } else {
      linhas.push({ ano: anoAtual, valor: totalPatrimonioAtual });
      linhas.sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));
    }
  }

  return linhas.map((r, i) => ({
    ano: r.ano,
    valor: r.valor,
    diferenca: i === 0 ? r.valor : r.valor - linhas[i - 1].valor,
  }));
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 1) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { vals.push(cur); cur = ""; }
      else cur += ch;
    }
    vals.push(cur);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
    return obj;
  });
}

async function fetchSheet(gid) {
  const r = await fetch(SHEET_BASE + gid, { cache: "no-store" });
  const t = await r.text();
  return parseCSV(t);
}

async function carregarPlanilha() {
  const entries = await Promise.all(
    Object.entries(SHEET_GIDS).map(async ([k, gid]) => [k, await fetchSheet(gid)])
  );
  return Object.fromEntries(entries);
}

function normalizarDadosLocais(salvoBruto) {
  const salvo = { ...(salvoBruto ?? {}) };
  delete salvo.mensagem;
  delete salvo.sucesso;
  const ativosSalvos = salvo.ativos ?? {};
  const ativos = Object.keys(ativosSalvos).length > 0 ? ativosSalvos : { ...ativosPadrao };
  const proventosSalvos = salvo.proventos ?? [];
  const proventos = proventosSalvos.length > 0 ? proventosSalvos : [...proventosPadrao];
  const evolucaoSalva = salvo.evolucao ?? [];
  const evolucao = evolucaoSalva.length > 0 ? evolucaoSalva : [...evolucaoPadrao];
  return {
    ...dadosLocaisPadrao(),
    ...salvo,
    ativos,
    proventos,
    evolucao,
    metas: { ...dadosLocaisPadrao().metas, ...(salvo.metas ?? {}) },
  };
}

function carregarDadosLocais() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return dadosLocaisPadrao();
    return normalizarDadosLocais(JSON.parse(raw));
  } catch {
    return dadosLocaisPadrao();
  }
}

function salvarDadosLocais(dadosLocais) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dadosLocais));
  } catch (err) {
    console.error("Erro ao salvar dados locais:", err);
  }
}

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

async function carregarDadosLocaisNuvem() {
  try {
    const snapshot = await get(ref(db, "dadosLocais"));
    const data = snapshot.val();
    return (data && typeof data === "object") ? data : {};
  } catch (err) {
    console.error("Erro ao carregar dados da nuvem:", err);
    return null;
  }
}

async function salvarDadosLocaisNuvem(dadosLocais) {
  try {
    await set(ref(db, "dadosLocais"), dadosLocais);
  } catch (err) {
    console.error("Erro ao salvar dados na nuvem:", err);
  }
}

const CLASSES_EM_DOLAR = ["stock", "reit", "etf"];

const BOLSA_POR_CLASSE = {
  acao: "BVMF",
  fii:  "BVMF",
};

function linkGoogleFinance(ticker, classe) {
  const t = String(ticker ?? "").trim().toUpperCase();
  if (!t) return null;
  const c = String(classe ?? "").toLowerCase().trim();

  if (c === "bitcoin") {
    return `https://www.google.com/finance/quote/${t}-USD`;
  }

  const bolsa = BOLSA_POR_CLASSE[c] || "NASDAQ";
  return `https://www.google.com/finance/quote/${t}:${bolsa}`;
}

const NOVO_ATIVO_MARCADOR = "__novo_ativo__";

function calcularTaxaDolar(ativosPlanilha) {
  const linhaMoeda = (ativosPlanilha ?? []).find(
    row => String(row.ticker ?? "").trim().toLowerCase() === "dolar"
  );
  return linhaMoeda ? toFloat(linhaMoeda.cotacao) : 1;
}

function buscarExtraAtivo(ativosExtra, ticker) {
  const alvo = String(ticker ?? "").trim();
  if (!alvo) return {};
  if (ativosExtra?.[alvo]) return ativosExtra[alvo];
  const chaveLower = alvo.toLowerCase();
  const chaveEncontrada = Object.keys(ativosExtra ?? {}).find(
    k => k.toLowerCase() === chaveLower
  );
  return chaveEncontrada ? ativosExtra[chaveEncontrada] : {};
}

function montarAtivos(ativosPlanilha, dadosLocais) {

  const taxaDolar = calcularTaxaDolar(ativosPlanilha);

  const tickersDaPlanilha = new Set(
    (ativosPlanilha ?? [])
      .filter(row => String(row.ticker ?? "").trim().toLowerCase() !== "dolar")
      .map(row => String(row.ticker ?? "").trim().toLowerCase())
  );

  const linhas = [
    ...(ativosPlanilha ?? [])
      .filter(row => String(row.ticker ?? "").trim().toLowerCase() !== "dolar")
      .map(row => ({
        ticker: String(row.ticker ?? "").trim(),
        cotacao: toFloat(row.cotacao),
        cotacao_ontem: toFloat(row.cotacao_ontem),
      })),
    ...Object.keys(dadosLocais.ativos ?? {})
      .filter(ticker => !tickersDaPlanilha.has(String(ticker).toLowerCase()))
      .map(ticker => ({
        ticker: String(ticker).trim(),
        cotacao: toFloat(dadosLocais.ativos[ticker]?.cotacao),
        cotacao_ontem: toFloat(dadosLocais.ativos[ticker]?.cotacao),
      })),
  ];

  const semPercentuais = linhas.map(({ ticker, cotacao, cotacao_ontem }) => {
    const extra = buscarExtraAtivo(dadosLocais.ativos, ticker);
    const quantidade = toFloat(extra.quantidade);
    const preco_medio = toFloat(extra.preco_medio);
    const classe = String(extra.classe || "").toLowerCase().trim();

    const taxa = CLASSES_EM_DOLAR.includes(classe) ? taxaDolar : 1;
    const total_investido = quantidade * preco_medio * taxa;
    const total_atual = quantidade * cotacao * taxa;
    const total_atual_ontem = quantidade * cotacao_ontem * taxa;
    const variacao_total = total_atual - total_investido;
    const variacao_percentual = total_investido > 0 ? (variacao_total / total_investido) * 100 : 0;

    const variacao_dia = total_atual - total_atual_ontem;
    const variacao_dia_percentual = total_atual_ontem > 0 ? (variacao_dia / total_atual_ontem) * 100 : 0;
    const variacao_cotacao = cotacao - cotacao_ontem;
    const variacao_cotacao_percentual = cotacao_ontem > 0 ? (variacao_cotacao / cotacao_ontem) * 100 : 0;

    return {
      ticker,
      cotacao,
      cotacao_ontem,
      nome: extra.nome || ticker,
      classe,
      quantidade,
      preco_medio,
      porcentagem_meta: toFloat(extra.porcentagem_meta),
      total_investido,
      total_atual,
      total_atual_ontem,
      variacao_total,
      variacao_percentual,
      variacao_dia,
      variacao_dia_percentual,
      variacao_cotacao,
      variacao_cotacao_percentual,
    };
  });

  const totalPorClasse = {};
  semPercentuais.forEach(a => {
    totalPorClasse[a.classe] = (totalPorClasse[a.classe] ?? 0) + a.total_atual;
  });

  return semPercentuais.map(a => {
    const totalClasse = totalPorClasse[a.classe] ?? 0;
    const porcentagem_atual = totalClasse > 0 ? (a.total_atual / totalClasse) * 100 : 0;
    const porcentagem_sobrando_faltando = porcentagem_atual - a.porcentagem_meta;
    return { ...a, porcentagem_atual, porcentagem_sobrando_faltando };
  });
}

function calcularTotais(ativos, reservaAtual, taxaDolar) {
  const t = {};
  let totalInvestimentos = 0;
  let aportadoInvestimentos = 0;
  let totalInvestimentosOntem = 0;

  CLASSES_ATIVOS.forEach(({ classe, sufixo }) => {
    const doClasse = ativos.filter(a => a.classe === classe);
    const total      = doClasse.reduce((s, a) => s + a.total_atual, 0);
    const totalOntem = doClasse.reduce((s, a) => s + a.total_atual_ontem, 0);
    const aportado   = doClasse.reduce((s, a) => s + a.total_investido, 0);
    t[`total_${sufixo}`]          = total;
    t[`total_ontem_${sufixo}`]    = totalOntem;
    t[`total_aportado_${sufixo}`] = aportado;
    t[`diferenca_${sufixo}`]      = total - aportado;
    t[`diferenca_dia_${sufixo}`]  = total - totalOntem;
    totalInvestimentos      += total;
    aportadoInvestimentos   += aportado;
    totalInvestimentosOntem += totalOntem;
  });

  const totalPatrimonio    = totalInvestimentos + reservaAtual;
  const totalPatrimonioOntem = totalInvestimentosOntem + reservaAtual;
  const aportadoPatrimonio = aportadoInvestimentos + reservaAtual;
  t.total_patrimonio             = totalPatrimonio;
  t.total_aportado               = aportadoPatrimonio;
  t.total_diferenca_patrimonio   = totalPatrimonio - aportadoPatrimonio;
  t.total_patrimonio_usd         = taxaDolar > 0 ? totalPatrimonio / taxaDolar : 0;

  t.total_investimentos          = totalInvestimentos;
  t.total_investimentos_ontem    = totalInvestimentosOntem;
  t.diferenca_dia_investimentos  = totalInvestimentos - totalInvestimentosOntem;

  t.total_patrimonio_ontem       = totalPatrimonioOntem;
  t.diferenca_dia_patrimonio     = totalPatrimonio - totalPatrimonioOntem;

  return [t];
}

function calcularAlocacao(totais, reservaAtual, metas) {
  const t = totais[0] ?? {};
  const totalPatrimonio = toFloat(t.total_patrimonio);
  const a = {};

  ALOCACAO_CLASSES.forEach(({ sufixo }) => {
    const valorAtual = sufixo === "reservas" ? reservaAtual : toFloat(t[`total_${sufixo}`]);
    const pctAtual    = totalPatrimonio > 0 ? (valorAtual / totalPatrimonio) * 100 : 0;
    const pctIdeal    = toFloat(metas[sufixo]);
    a[`alocacao_atual_${sufixo}`]      = pctAtual;
    a[`alocacao_ideal_${sufixo}`]      = pctIdeal;
    a[`alocacao_diferenca_${sufixo}`]  = pctAtual - pctIdeal;
  });

  return [a];
}

function Card({ children, className = "", style = {} }) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

function IconeCard({ nome, size = 21 }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
  };
  switch (nome) {
    case "patrimonio":
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="12" cy="12" r="9" />
          <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none">
            $
          </text>
        </svg>
      );
    case "reserva":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
        </svg>
      );
    case "investimentos":
      return (
        <svg {...p} className="card-titulo-icone">
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <path d="M6.5 15l4-4 3 3 4.5-5.5" />
        </svg>
      );
    case "globo":
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.8 2.5 4.4 5.6 4.4 9s-1.6 6.5-4.4 9c-2.8-2.5-4.4-5.6-4.4-9s1.6-6.5 4.4-9Z" />
        </svg>
      );
    case "alocacao":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M21.5 12A9.5 9.5 0 1 1 9 2.6" />
          <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5V12Z" />
        </svg>
      );
    case "aporte":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 17l6-6 4 4 7-8" />
          <path d="M14 6h6v6" />
        </svg>
      );
    case "proventos":
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="9" cy="9" r="5.5" />
          <circle cx="15.5" cy="15.5" r="5.5" />
        </svg>
      );
    case "heatmap":
      return (
        <svg {...p} className="card-titulo-icone">
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.2" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2" />
        </svg>
      );
    case "stock":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 3v18h18" />
          <rect x="7" y="12" width="3" height="6" />
          <rect x="12" y="8" width="3" height="10" />
          <rect x="17" y="5" width="3" height="13" />
        </svg>
      );
    case "reit":
      return (
        <svg {...p} className="card-titulo-icone">
          <rect x="4" y="3" width="16" height="18" rx="1" />
          <path d="M9 21v-4h6v4" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" />
        </svg>
      );
    case "etf":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M8 9c0-3 1.8-5 4-5s4 2 4 5" />
          <path d="M5 9h14l-1.6 10.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8L5 9Z" />
          <path d="M9.5 13v4M12 13v4M14.5 13v4" />
        </svg>
      );
    case "acao":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M6 3v4M6 13v8" />
          <rect x="3.5" y="7" width="5" height="6" rx="0.5" />
          <path d="M12 3v2M12 13v8" />
          <rect x="9.5" y="5" width="5" height="8" rx="0.5" />
          <path d="M18 3v6M18 16v5" />
          <rect x="15.5" y="9" width="5" height="7" rx="0.5" />
        </svg>
      );
    case "fii":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );
    case "bitcoin":
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="12" cy="12" r="9" />
          <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none">
            ₿
          </text>
        </svg>
      );
    case "financas":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
          <path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" />
          <path d="M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
        </svg>
      );
    case "cotacoes":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 17l5-5 4 4 8-9" />
          <path d="M15 7h5v5" />
        </svg>
      );
    case "seta-cima":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      );
    case "seta-baixo":
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M12 5v14" />
          <path d="M5 12l7 7 7-7" />
        </svg>
      );
    default:
      return null;
  }
}

const ICONE_POR_SUFIXO = {
  stocks: "stock", reits: "reit", etfs: "etf", acoes: "acao", fiis: "fii", bitcoins: "bitcoin",
};

function SubCard({ children, className = "", style = {}, id }) {
  return (
    <div id={id} className={`subcard ${className}`} style={style}>
      {children}
    </div>
  );
}

function HeroValor({ titulo, valor, cor, visible = true, className = "" }) {
  return (
    <div className={`hero-valor ${className}`}>
      <span className="campo-titulo hero-valor-titulo">{titulo}</span>
      <span
        className="campo-valor hero-valor-valor animated-value"
        style={{
          ...(cor ? { color: cor } : {}),
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {valor}
      </span>
    </div>
  );
}

function BarraSimples({ pct, cor, style = {} }) {
  return (
    <div className="barra-track" style={style}>
      <div className="barra-fill full" style={{ width: `${Math.max(Math.min(pct, 100), 0)}%`, background: cor }} />
    </div>
  );
}

function ListRow({ label, tag, value, valueColor, sub, subColor, onClick, onMouseEnter, onMouseLeave, chevron = false, plain = false, highlight = false, highlightColor }) {
  return (
    <div
      className={`list-row${plain ? " list-row-plain" : ""}${onClick ? " list-row-clickable" : ""}${highlight ? " list-row-filtrado" : ""}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={highlight && highlightColor ? { "--hl-bg": `${highlightColor}22`, "--hl-border": `${highlightColor}80` } : undefined}
    >
      <div className="list-row-left">
        <span className="list-row-label">{label}</span>
        {tag && <span className="list-row-tag">{tag}</span>}
      </div>
      <div className="list-row-right">
        <div className="list-row-values">
          <span className="list-row-value" style={valueColor ? { color: valueColor } : {}}>{value}</span>
          {sub && <span className="list-row-sub" style={subColor ? { color: subColor } : {}}>{sub}</span>}
        </div>
        {chevron && (
          <svg className="list-row-chevron" width="7" height="12" viewBox="0 0 7 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

function criarBrilho(e, btn) {
  if (!btn) return;
  btn.classList.remove("click-glow");

  void btn.offsetWidth;
  btn.classList.add("click-glow");
  const onEnd = () => {
    btn.classList.remove("click-glow");
    btn.removeEventListener("animationend", onEnd);
  };
  btn.addEventListener("animationend", onEnd);
}

function BotaoFiltro({ children, onClick, ativo, seta, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button
      className={`btn-filtro-simples${ativo ? " btn-filtro-simples-ativo" : ""}`}
      onClick={handleClick}
    >
      <span ref={btnRef} className="btn-texto">{children}</span>
      {seta && (
        <svg className={`btn-ver-icon ${open ? "is-open" : ""}`} width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

function BotaoFiltroTrigger({ children, onClick, ativo, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button
      className={`btn-filtro-simples dropdown-trigger${ativo ? " btn-filtro-simples-ativo" : ""}`}
      onClick={handleClick}
      aria-expanded={open}
      aria-label="Filtrar"
    >
      <span ref={btnRef} className="btn-texto">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <circle cx="9" cy="6" r="2" fill="var(--bg3)" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <circle cx="15" cy="12" r="2" fill="var(--bg3)" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="11" cy="18" r="2" fill="var(--bg3)" />
        </svg>
        {children}
      </span>
    </button>
  );
}

function BotaoVer({ onClick, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button className="btn-tema" onClick={handleClick} aria-label={open ? "Ocultar" : "Ver mais"}>
      <span ref={btnRef} className="btn-texto">
        <svg className={`btn-ver-icon ${open ? "is-open" : ""}`} width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    </button>
  );
}

function Expandable({ open, children }) {
  const wrapRef = useRef(null);
  const estadoAnteriorRef = useRef(undefined);

  const getParentGap = (el) => {
    const parent = el?.parentElement;
    if (!parent) return 0;
    const g = getComputedStyle(parent).rowGap || getComputedStyle(parent).gap;
    const n = parseFloat(g);
    return isNaN(n) ? 0 : n;
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const anterior = estadoAnteriorRef.current;
    estadoAnteriorRef.current = open;

    if (anterior === undefined || anterior === open) {
      el.style.transition = "none";
      if (open) {
        el.style.height = "auto";
        el.style.opacity = "1";
        el.style.marginTop = "0px";
        el.style.marginBottom = "0px";
      } else {
        el.style.height = "0px";
        el.style.opacity = "0";
        const gap = getParentGap(el);
        el.style.marginTop = `-${gap / 2}px`;
        el.style.marginBottom = `-${gap / 2}px`;
      }
      return;
    }

    if (open) {
      el.style.marginTop = "0px";
      el.style.marginBottom = "0px";
      el.style.height = "0px";
      el.style.opacity = "0";
      void el.offsetHeight;
      const target = el.scrollHeight;
      el.style.transition = "height 0.42s cubic-bezier(0.4,0,0.2,1), opacity 0.32s cubic-bezier(0.4,0,0.2,1) 0.06s, margin 0.42s cubic-bezier(0.4,0,0.2,1)";
      el.style.height = target + "px";
      el.style.opacity = "1";
      const t = setTimeout(() => {
        if (el) el.style.height = "auto";
      }, 440);
      return () => clearTimeout(t);
    } else {
      const current = el.scrollHeight;
      el.style.height = current + "px";
      el.style.opacity = "1";
      void el.offsetHeight;
      el.style.transition = "height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.22s cubic-bezier(0.4,0,0.2,1), margin 0.38s cubic-bezier(0.4,0,0.2,1)";
      el.style.height = "0px";
      el.style.opacity = "0";
      const gap = getParentGap(el);
      el.style.marginTop = `-${gap / 2}px`;
      el.style.marginBottom = `-${gap / 2}px`;
    }
  }, [open]);

  return (
    <div
      ref={wrapRef}
      style={{
        height: 0,
        overflow: "hidden",
        opacity: 0,
        willChange: "height, opacity, margin",
      }}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
    </div>
  );
}

function Loading({ tema }) {
  const [logoErr, setLogoErr] = useState(false);

  return (
    <div className="loading-page">
      <div className="loading-box">
        {logoErr ? (
          <div className="loading-logo loading-logo-breathe">V</div>
        ) : (
          <img
            src={tema === "light" ? "/assets/logo_light.png" : "/assets/logo_dark.png"}
            alt="ValueUp logo"
            onError={() => setLogoErr(true)}
            className="loading-logo-breathe loading-logo-img"
          />
        )}
        <Spinner />
        <p className="loading-texto">Carregando dados...</p>
      </div>
    </div>
  );
}

function LogoAtivo({ ticker, size = 72, offsetX = 0, className = "" }) {
  const [src, setSrc] = useState(() => `/logos/${String(ticker).toUpperCase()}.png`);
  const [estagio, setEstagio] = useState("local");

  useEffect(() => {
    setSrc(`/logos/${String(ticker).toUpperCase()}.png`);
    setEstagio("local");
  }, [ticker]);

  function handleErro() {
    setEstagio("letra");
  }

  if (estagio === "letra") {
    return (
      <div className={className} style={{
        width: size, height: size, background: "var(--accent)",
        borderRadius: 14, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.42,
        fontWeight: 500, color: "#f5f5f7", flexShrink: 0,
        marginLeft: offsetX,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'
      }}>
        {String(ticker)[0]}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={ticker}
      width={size} height={size}
      onError={handleErro}
      style={{ borderRadius: 12, objectFit: "contain", flexShrink: 0, marginLeft: offsetX }}
    />
  );
}

function Navbar({ scrolled, ativos, onSelectTicker, pagina, onNavigate, onNovoLancamento, tema, onAlternarTema }) {
  const [logoErr, setLogoErr]       = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery]           = useState("");
  const [isMobile, setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  const [menuAberto, setMenuAberto] = useState(false);
  const searchRef                   = useRef(null);
  const inputRef                    = useRef(null);
  const menuRef                     = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (!e.target.closest(".navbar") && !e.target.closest(".navbar-search-results")) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  useEffect(() => {
    if (!menuAberto) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e) => { if (e.key === "Escape") setMenuAberto(false); };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handler);
    };
  }, [menuAberto]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [searchOpen]);

  const resultados = query.trim().length >= 1
    ? (ativos ?? []).filter(a =>
        String(a.ticker ?? "").toLowerCase().includes(query.toLowerCase()) ||
        String(a.nome   ?? "").toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : [];

  return (
    <nav className={`navbar ${scrolled ? "navbar-scrolled" : ""}`}>
      <div className="navbar-inner">

        <div className="navbar-left">

          {logoErr ? (
            <span className="navbar-logo">V</span>
          ) : (
            <img src={tema === "light" ? "/assets/logo_light.png" : "/assets/logo_dark.png"} alt="ValueUp" className="navbar-logo-img"
              onError={() => setLogoErr(true)} />
          )}
        </div>

        <div className="navbar-nav">
          <div className="navbar-tabs">
            {PAGINAS.map(p => (
              <button
                key={p.id}
                className={`navbar-tab${pagina === p.id ? " navbar-tab-ativo" : ""}`}
                onClick={() => onNavigate(p.id)}
              >
                {p.titulo}
              </button>
            ))}
          </div>
        </div>

        <div className="navbar-right">

        <div className="navbar-hamburger-wrap" ref={menuRef}>
          <button
            className="btn-tema navbar-hamburger"
            onClick={() => setMenuAberto(o => !o)}
            aria-label="Menu de navegação"
            title="Navegação"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {menuAberto && createPortal(
            <div
              className="navbar-menu-overlay"
              onClick={(e) => e.target === e.currentTarget && setMenuAberto(false)}
            >
              <div className="navbar-menu-overlay-header">
                <div className="navbar-left">
                  {logoErr ? (
                    <span className="navbar-logo">V</span>
                  ) : (
                    <img src={tema === "light" ? "/assets/logo_light.png" : "/assets/logo_dark.png"} alt="ValueUp" className="navbar-logo-img"
                      onError={() => setLogoErr(true)} />
                  )}
                </div>
                <button className="btn-tema" onClick={() => setMenuAberto(false)} aria-label="Fechar menu">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="5" y1="5" x2="19" y2="19" />
                    <line x1="19" y1="5" x2="5" y2="19" />
                  </svg>
                </button>
              </div>

              <div className="navbar-menu-overlay-list">
                {PAGINAS.map(p => (
                  <button
                    key={p.id}
                    className={`navbar-menu-overlay-item${pagina === p.id ? " is-ativo" : ""}`}
                    onClick={() => { onNavigate(p.id); setMenuAberto(false); }}
                  >
                    {p.titulo}
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )}
        </div>

        {pagina === "financas" && (
          <button
            className="btn-tema"
            title="Novo lançamento"
            onClick={onNovoLancamento}
            aria-label="Novo lançamento"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}

        {(pagina === "investimentos" || pagina === "cotacoes") && (
        <div style={{ position: "relative" }} ref={searchRef}>
          {isMobile ? (
            <button
              className="btn-tema"
              title="Buscar ativo"
              onClick={() => { setSearchOpen(o => !o); setQuery(""); }}
              aria-label="Buscar ativo"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          ) : (
            <div className="navbar-search-inline">
              <span className="navbar-search-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                  <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
              <input
                ref={inputRef}
                className="navbar-search-inline-input"
                placeholder="Buscar ativo..."
                value={query}
                onChange={e => { setQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
            </div>
          )}

          {((isMobile && searchOpen) ||
            (!isMobile && query.trim().length >= 1)) && (
            <div
              className={
                isMobile
                  ? "navbar-search-box"
                  : "navbar-search-box navbar-search-box-desktop"
              }
            >
              {isMobile && (
                <input
                  ref={inputRef}
                  className="navbar-search-input"
                  placeholder="Buscar ativo..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              )}

              {resultados.length > 0 && (
                <div className="navbar-search-results">
                  {resultados.map((a, i) => (
                    <button
                      key={i}
                      className="navbar-search-item"
                      onClick={() => {
                        const sufixo = CLASSES_ATIVOS.find(
                          c => String(a.classe).toLowerCase().trim() === c.classe
                        )?.sufixo;

                        if (sufixo) onSelectTicker(a.ticker);

                        setSearchOpen(false);
                        setQuery("");
                      }}
                    >
                      <LogoAtivo ticker={a.ticker} size={28} />

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
                          textAlign: "left"
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--color-value)"
                          }}
                        >
                          {a.ticker}
                        </span>

                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-label)"
                          }}
                        >
                          {a.nome}
                        </span>
                      </div>

                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          color: "var(--color-label)"
                        }}
                      >
                        {String(a.classe ?? "")}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {query.trim().length >= 1 && resultados.length === 0 && (
                <div className="navbar-search-results">
                  <div
                    style={{
                      padding: "var(--space-3) var(--space-4)",
                      color: "var(--color-label)",
                      fontSize: 13
                    }}
                  >
                    Nenhum ativo encontrado
                  </div>
                </div>
              )}
            </div>
          )}

          </div>
        )}

        <button
          className="btn-tema"
          onClick={onAlternarTema}
          aria-label={tema === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
          title={tema === "dark" ? "Tema claro" : "Tema escuro"}
        >
          {tema === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4.5" />
              <line x1="12" y1="2.5" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="21.5" />
              <line x1="4.2" y1="4.2" x2="6" y2="6" />
              <line x1="18" y1="18" x2="19.8" y2="19.8" />
              <line x1="2.5" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="21.5" y2="12" />
              <line x1="4.2" y1="19.8" x2="6" y2="18" />
              <line x1="18" y1="6" x2="19.8" y2="4.2" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.7 6.7 0 0 0 10.5 10.5Z" />
            </svg>
          )}
        </button>

        </div>

      </div>

    </nav>
  );
}

function BotaoTopoFlutuante({ scrolled, onTop }) {
  return (
    <button
      className={`btn-topo-flutuante ${scrolled ? "btn-topo-flutuante-visible" : ""}`}
      onClick={onTop}
      title="Voltar ao Topo"
      aria-label="Voltar ao topo"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}

const ANOS_PADRAO_HISTORICO = 8;

function SeletorAno({ anos, anoInicio, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const atualizarPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const cardRect = triggerRef.current?.closest(".subcard")?.getBoundingClientRect();

    setPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width,
      height: cardRect ? cardRect.height * 0.65 : 0,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    atualizarPos();
    const handleClickFora = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) setOpen(false);
    };
    window.addEventListener("scroll", atualizarPos, true);
    window.addEventListener("resize", atualizarPos);
    document.addEventListener("mousedown", handleClickFora);
    return () => {
      window.removeEventListener("scroll", atualizarPos, true);
      window.removeEventListener("resize", atualizarPos);
      document.removeEventListener("mousedown", handleClickFora);
    };
  }, [open, atualizarPos]);

  if (!anos?.length) return null;

  return (
    <div className="dropdown-wrap" ref={triggerRef} style={{ marginLeft: "-6px" }}>
      <BotaoFiltroTrigger open={open} onClick={() => setOpen(o => !o)}>
        <span className="dropdown-trigger-sub">Desde {anoInicio}</span>
      </BotaoFiltroTrigger>
      {open && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu dropdown-menu-flutuante dropdown-menu-select dropdown-menu-anos"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.height || undefined }}
        >
          {anos.map(ano => (
            <button
              key={ano}
              className={`dropdown-item${ano === anoInicio ? " is-ativo" : ""}`}
              onClick={() => { onChange(ano); setOpen(false); }}
            >
              {ano}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function SeletorForm({ value, onChange, options, placeholder = "Selecione..." }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const atualizarPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    atualizarPos();
    const handleClickFora = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) setOpen(false);
    };
    window.addEventListener("scroll", atualizarPos, true);
    window.addEventListener("resize", atualizarPos);
    document.addEventListener("mousedown", handleClickFora);
    return () => {
      window.removeEventListener("scroll", atualizarPos, true);
      window.removeEventListener("resize", atualizarPos);
      document.removeEventListener("mousedown", handleClickFora);
    };
  }, [open, atualizarPos]);

  const selecionado = options.find(o => o.value === value);

  return (
    <div ref={triggerRef}>
      <button
        type="button"
        className={`form-input form-select${open ? " form-select-aberto" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span style={{ color: selecionado ? "var(--color-value)" : "var(--color-label)" }}>
          {selecionado ? selecionado.label : placeholder}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu dropdown-menu-flutuante dropdown-menu-select"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              className={`dropdown-item${o.value === value ? " is-ativo" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function CardPatrimonio({ totais, evolucao, onEditarEvolucao }) {

  const total = toFloat(totais?.[0]?.total_patrimonio);

  const dataEvolucaoBruta = calcularEvolucaoComDiferenca(evolucao, total)
    .map(row => ({ ano: row.ano, valor: row.valor, diff: row.diferenca }));
  const temEvolucao = dataEvolucaoBruta.length > 0;
  const anosNumEvolucao = dataEvolucaoBruta.map(d => parseInt(d.ano, 10)).filter(n => !isNaN(n));
  const anoAtualNum = new Date().getFullYear();
  const [anoInicioEvolucao, setAnoInicioEvolucao] = useState(anoAtualNum - (ANOS_PADRAO_HISTORICO - 1));

  if (!totais?.length) return null;
  const t = totais[0];
  const aportado  = toFloat(t.total_aportado);
  const diff      = toFloat(t.total_diferenca_patrimonio);
  const totalUSD  = toFloat(t.total_patrimonio_usd);
  const totalOntem = toFloat(t.total_patrimonio_ontem);
  const diffDia     = toFloat(t.diferenca_dia_patrimonio);
  const diffDiaPct  = totalOntem > 0 ? (diffDia / totalOntem) * 100 : 0;

  const corDiff = corVar(diff);
  const corDiffDia = corVar(diffDia);

  const pctVariacao  = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;

  const dataEvolucao = dataEvolucaoBruta.filter(d => parseInt(d.ano, 10) >= anoInicioEvolucao);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="patrimonio" />Patrimônio</h2>
        </SubCard>
        {onEditarEvolucao && (
          <button className="btn-tema" onClick={onEditarEvolucao} aria-label="Editar evolução do patrimônio" title="Editar evolução do patrimônio">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        <ListRow label="Aportado" value={fmtBRL(aportado)} plain />

        {!!totalUSD && (
          <ListRow label="Atual em USD" value={fmtUSD(totalUSD)} plain />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label="Variação"
              value={`${sinal(diff)}${fmtBRL(diff)} (${pctVariacao.toFixed(1)}%)`}
              valueColor={corDiff}
              plain
            />
            <ListRow
              label="Variação do dia"
              value={`${sinalCompleto(diffDia)}${fmtBRL(Math.abs(diffDia))} (${sinalCompleto(diffDiaPct)}${Math.abs(diffDiaPct).toFixed(2)}%)`}
              valueColor={corDiffDia}
              plain
            />
          </div>
        </div>
      </SubCard>

      {temEvolucao && (
        <SubCard style={{ overflow: "hidden" }}>
          <HeroValor titulo="Patrimônio atual" valor={fmtBRL(total)} visible={!!total} />
          <div className="card-header" style={{ margin: "var(--space-2) 0" }}>
            <SeletorAno anos={anosNumEvolucao} anoInicio={anoInicioEvolucao} onChange={setAnoInicioEvolucao} />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dataEvolucao} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
              <defs>
                <linearGradient id="gradEv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={COR_ALTA} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COR_ALTA} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ano" tick={<EvolucaoXTick />} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide />
              <Tooltip content={<CustomTooltipEvolucao />} />
              <Area type="monotone" dataKey="valor" stroke={COR_ALTA} strokeWidth={2.5}
                fill="url(#gradEv)" dot={{ fill: COR_ALTA, r: 4 }}
                activeDot={{ r: 6, fill: COR_ALTA }}
              />
              <Area type="monotone" dataKey="diff" stroke="none" fill="none" dot={false} activeDot={false} legendType="none" />
            </AreaChart>
          </ResponsiveContainer>
        </SubCard>
      )}
    </Card>
  );
}

function CustomTooltipEvolucao({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif' }}>
      <div className="tooltip-label">{label}</div>
      <div className="tooltip-val" style={{ color: "var(--color-value)" }}>{fmtBRL(payload[0].value)}</div>
      {payload[1] && (
        <div className="tooltip-sub" style={{ color: corVar(payload[1].value) }}>
          {sinal(payload[1].value)}{fmtBRL(payload[1].value)}
        </div>
      )}
    </div>
  );
}

function EvolucaoXTick({ x, y, payload }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;
  const fontSize = isMobile ? "clamp(8px, 1.8vw, 10px)" : 10;
  return (
    <text x={x} y={y + 10} textAnchor="middle" fill="#9a9d9c" fontSize={fontSize} fontFamily='-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'>
      {payload.value}
    </text>
  );
}

function CardReserva({ reservas, alocacao, totais, onEditar }) {
  if (!reservas?.length || !alocacao?.length) return null;
  const r = reservas[0], a = alocacao[0];
  const aktual   = toFloat(r.reserva_atual);
  const pctIdeal = toFloat(a.alocacao_ideal_reservas);

  const totalPatrimonio = toFloat(totais?.[0]?.total_patrimonio);
  const valorIdeal      = totalPatrimonio * pctIdeal / 100;
  const valorDiferenca  = aktual - valorIdeal;
  const textoSF         = valorDiferenca > 0 ? "Sobrando" : valorDiferenca < 0 ? "Faltando" : "Ok";
  const valorD           = Math.abs(valorDiferenca);
  const corDiferenca     = corVar(valorDiferenca);
  const ssf               = sinalCompleto(valorDiferenca);

  const pctVariacao = valorIdeal > 0 ? Math.abs(valorDiferenca) / valorIdeal * 100 : 0;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="reserva" />Reserva</h2>
        </SubCard>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar reserva" title="Editar reserva">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(aktual)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label={textoSF}
              value={`${ssf}${fmtBRL(valorD)}${pctVariacao > 0 ? ` (${pctVariacao.toFixed(1)}%)` : ""}`}
              valueColor={corDiferenca}
              plain
            />
            <ListRow
              label="Meta"
              value={`${fmtBRL(valorIdeal)} (${pctIdeal.toFixed(1)}%)`}
              plain
            />
          </div>
        </div>
      </SubCard>
    </Card>
  );
}

function CardResumoInvestimentos({ totais }) {
  if (!totais?.length) return null;
  const t = totais[0];

  const total    = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`total_${c.sufixo}`]), 0);
  const aportado = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`total_aportado_${c.sufixo}`]), 0);
  const diff     = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`diferenca_${c.sufixo}`]), 0);
  const totalOntem = toFloat(t.total_investimentos_ontem);
  const diffDia     = toFloat(t.diferenca_dia_investimentos);
  const diffDiaPct  = totalOntem > 0 ? (diffDia / totalOntem) * 100 : 0;

  const corDiff = corVar(diff);
  const corDiffDia = corVar(diffDia);

  const pctVariacao = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo"><IconeCard nome="investimentos" />Investimentos</h2>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        <ListRow label="Aportado" value={fmtBRL(aportado)} plain />

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label="Variação"
              value={`${sinal(diff)}${fmtBRL(diff)} (${pctVariacao.toFixed(1)}%)`}
              valueColor={corDiff}
              plain
            />
            <ListRow
              label="Variação do dia"
              value={`${sinalCompleto(diffDia)}${fmtBRL(Math.abs(diffDia))} (${sinalCompleto(diffDiaPct)}${Math.abs(diffDiaPct).toFixed(2)}%)`}
              valueColor={corDiffDia}
              plain
            />
          </div>
        </div>
      </SubCard>
    </Card>
  );
}

function BarraAlocacao({ dados }) {
  return (
    <SubCard>
      <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
        {dados.map((d, i) => {
          const cor = PALETA_ALOCACAO[i % PALETA_ALOCACAO.length];
          return (
            <div key={d.titulo} className="alocacao-item">
              <ListRow
                label={
                  <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: cor, flexShrink: 0 }} />
                      {d.titulo}
                    </span>
                    {d.ideal > 0 && (
                      <span className="list-row-tag">Meta {d.ideal.toFixed(1)}%</span>
                    )}
                  </span>
                }
                value={`${d.pct.toFixed(1)}%`}
                sub={d.diff != null ? `${sinal(d.diff)}${d.diff.toFixed(2)}%` : undefined}
                subColor={corVar(d.diff)}
                plain
              />
              <div className="alocacao-mini-barra">
                <div className="alocacao-mini-barra-fill" style={{ width: `${Math.max(Math.min(d.pct, 100), 0)}%`, background: cor }} />
              </div>
            </div>
          );
        })}
      </div>
    </SubCard>
  );
}

function CardClassesAtivos({ totais, reservas }) {
  if (!totais?.length) return null;
  const t = totais[0];
  const totalPatrimonio = toFloat(t.total_patrimonio);
  const reservaAtual = toFloat(reservas?.[0]?.reserva_atual);

  const dados = ALOCACAO_CLASSES.map((c) => {
    const valor = c.sufixo === "reservas" ? reservaAtual : toFloat(t[`total_${c.sufixo}`]);
    const pct   = totalPatrimonio > 0 ? (valor / totalPatrimonio) * 100 : 0;
    return {
      titulo: c.titulo,
      sufixo: c.sufixo,
      valor,
      pct,
    };
  });

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo"><IconeCard nome="alocacao" />Alocação do patrimônio</h2>
      </SubCard>

      <SubCard>
        <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
          {dados.map(d => (
            <ListRow
              key={d.sufixo}
              label={d.titulo}
              value={fmtBRL(d.valor)}
              sub={`${d.pct.toFixed(1)}%`}
              plain
            />
          ))}
        </div>
      </SubCard>
    </Card>
  );
}

function CardAlocacao({ alocacao, onEditar }) {
  if (!alocacao?.length) return null;
  const a = alocacao[0];

  const dados = ALOCACAO_CLASSES.map((c, i) => ({
    ...c,
    pct:   toFloat(a[`alocacao_atual_${c.sufixo}`]),
    ideal: toFloat(a[`alocacao_ideal_${c.sufixo}`]),
    diff:  toFloat(a[`alocacao_diferenca_${c.sufixo}`]),
    cor:   PALETA_ALOCACAO[i % PALETA_ALOCACAO.length],
  }));

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="alocacao" />Alocação</h2>
        </SubCard>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar metas de alocação" title="Editar metas de alocação">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <BarraAlocacao dados={dados} />
    </Card>
  );
}

const BRASIL_EXTERIOR_COR = { brasil: "#16bdb4", exterior: "#8d908f" };

function CardBrasilExterior({ alocacao, totais }) {
  if (!alocacao?.length || !totais?.length) return null;
  const a = alocacao[0];
  const t = totais[0];
  const totalPatrimonio = toFloat(t.total_patrimonio);

  const pctBrasil =
    toFloat(a.alocacao_atual_acoes) +
    toFloat(a.alocacao_atual_fiis) +
    toFloat(a.alocacao_atual_reservas);

  const pctExterior =
    toFloat(a.alocacao_atual_stocks) +
    toFloat(a.alocacao_atual_reits) +
    toFloat(a.alocacao_atual_etfs) +
    toFloat(a.alocacao_atual_bitcoins);

  const valorBrasil   = (pctBrasil   / 100) * totalPatrimonio;
  const valorExterior = (pctExterior / 100) * totalPatrimonio;

  const dados = [
    { titulo: "Brasil",   pct: pctBrasil,   valor: valorBrasil,   cor: BRASIL_EXTERIOR_COR.brasil   },
    { titulo: "Exterior", pct: pctExterior, valor: valorExterior, cor: BRASIL_EXTERIOR_COR.exterior },
  ];

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo"><IconeCard nome="globo" />Brasil x Exterior</h2>
      </SubCard>

      <SubCard>
        <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
          {dados.map(d => (
            <ListRow
              key={d.titulo}
              label={d.titulo}
              value={`${d.pct.toFixed(1)}%`}
              sub={fmtBRL(d.valor)}
              plain
            />
          ))}
        </div>
      </SubCard>
    </Card>
  );
}

function CardAporte({ ativos, alocacao }) {
  if (!ativos?.length || !alocacao?.length) return null;
  const a = alocacao[0];

  const APORTE_MAP = {
    stock:   ["alocacao_ideal_stocks",   "alocacao_atual_stocks"  ],
    reit:    ["alocacao_ideal_reits",    "alocacao_atual_reits"   ],
    etf:     ["alocacao_ideal_etfs",     "alocacao_atual_etfs"    ],
    acao:    ["alocacao_ideal_acoes",    "alocacao_atual_acoes"   ],
    fii:     ["alocacao_ideal_fiis",     "alocacao_atual_fiis"    ],
    bitcoin: ["alocacao_ideal_bitcoins", "alocacao_atual_bitcoins"],
    reserva: ["alocacao_ideal_reservas", "alocacao_atual_reservas"],
  };

  const ORDEM = [
    { classe: "stock",   nome: "Stocks"   },
    { classe: "reit",    nome: "Reits"    },
    { classe: "acao",    nome: "Ações"    },
    { classe: "fii",     nome: "Fiis"     },
    { classe: "etf",     nome: "Etfs"     },
    { classe: "bitcoin", nome: "Bitcoins" },
    { classe: "reserva", nome: "Reserva" },
  ];

  const deficits = ORDEM.map(({ classe, nome }) => {
    const [ki, ka] = APORTE_MAP[classe];
    const ideal  = toFloat(a[ki]);
    const aktual = toFloat(a[ka]);
    const diff   = ideal - aktual;
    return { classe, nome, ideal, atual: aktual, diff };
  }).filter(d => d.ideal > 0 && d.diff > 0).sort((a, b) => b.diff - a.diff);

  const classePrio = deficits[0] ?? null;

  const ativosPrioClasse = classePrio
    ? ativos
        .filter(at => String(at.classe ?? "").toLowerCase().trim() === classePrio.classe)
        .sort((a, b) => toFloat(a.porcentagem_sobrando_faltando) - toFloat(b.porcentagem_sobrando_faltando))
    : [];

  const ativo1Obj = ativosPrioClasse[0] ?? null;
  const ativo2Obj = ativosPrioClasse[1] ?? null;

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo"><IconeCard nome="aporte" />Aporte</h2>
      </SubCard>

      {classePrio && (() => {
        return (
          <SubCard>
            <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
              <div className="list-row-left">
                <span className="list-row-label">Classe prioritária</span>
              </div>
              <div className="list-row-right">
                <span className="list-row-value">{classePrio.nome}</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
                <ListRow label="Atual" value={`${classePrio.atual.toFixed(1)}%`} plain />
                <ListRow label="Meta" value={`${classePrio.ideal.toFixed(1)}%`} plain />
                <ListRow
                  label="Faltando"
                  value={`-${classePrio.diff.toFixed(1)}%`}
                  valueColor={COR_BAIXA}
                  plain
                />
              </div>
            </div>
          </SubCard>
        );
      })()}

      {ativo1Obj && (
        <CardAtivo ativo={ativo1Obj} soMeta titulo="Ativo prioritário 1" />
      )}

      {ativo2Obj && (
        <CardAtivo ativo={ativo2Obj} soMeta titulo="Ativo prioritário 2" />
      )}
    </Card>
  );
}

function GraficoProventos({ porAno }) {
  const [hovIdx, setHovIdx] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const vMax     = Math.max(...porAno.map(r => r.valor), 1);
  const anoAtual = String(new Date().getFullYear());
  const CHART_H  = 220;
  const BAR_GAP  = 10;

  const [containerW, setContainerW] = useState(0);
  const handleMouseMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContainerW(rect.width);
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      style={{ position: "relative", width: "100%", boxSizing: "border-box" }}
    >
      {hovIdx !== null && (() => {
        const d        = porAno[hovIdx];
        const anterior = hovIdx > 0 ? porAno[hovIdx - 1].valor : null;
        const diff     = anterior !== null ? d.valor - anterior : null;
        const isRightSide = mousePos.x > containerW / 2;
        return (
          <div className="chart-tooltip" style={{
            position: "absolute",
            left: mousePos.x,
            top: mousePos.y,
            transform: isRightSide
              ? "translate(calc(-100% - 14px), calc(-100% - 14px))"
              : "translate(14px, calc(-100% - 14px))",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 10,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
          }}>
            <div className="tooltip-label">{d.ano}</div>
            <div className="tooltip-val" style={{ color: "var(--color-value)" }}>{fmtBRL(d.valor)}</div>
            {diff !== null && (
              <div className="tooltip-sub" style={{ color: corVar(diff) }}>
                {sinal(diff)}{fmtBRL(diff)}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: BAR_GAP,
        height: CHART_H,
        overflow: "visible",
      }}>
        {porAno.map((d, i) => {
          const heightPct = (d.valor / vMax) * 100;
          const isHov     = hovIdx === i;
          const isCurrent = d.ano === anoAtual;

          return (
            <div
              key={d.ano}
              onMouseEnter={() => setHovIdx(i)}
              onMouseLeave={() => setHovIdx(null)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                height: "100%",
                justifyContent: "flex-end",
                cursor: "default",
                position: "relative",
              }}
            >
              <div className="barra-proventos" style={{
                width: "100%",
                height: `${heightPct}%`,
                minHeight: d.valor > 0 ? 4 : 0,
                background: isHov ? "#13a097" : isCurrent ? "#13a097" : "#0a5550",
                transition: "height 0.6s cubic-bezier(0.4,0,0.2,1), background 0.15s",
                position: "relative",
                overflow: "hidden",
              }}>
                {isHov && (
                  <div className="barra-proventos-glow" style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 60%)",
                  }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: BAR_GAP, marginTop: "var(--space-2)" }}>
        {porAno.map((d, i) => (
          <div key={d.ano} style={{
            flex: 1,
            textAlign: "center",
            fontSize: "clamp(8px, 1.8vw, 11px)",
            fontWeight: 500,
            color: d.ano === anoAtual ? "#13a097" : hovIdx === i ? "var(--color-value)" : "var(--color-label)",
            transition: "color 0.15s",
            minWidth: 0,
            whiteSpace: "nowrap",
          }}>
            {d.ano}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardProventos({ proventos, onEditar }) {
  const porAnoCompleto = (proventos ?? [])
    .map(row => ({ ano: String(row.ano ?? ""), valor: toFloat(row.total_ano) }))
    .filter(r => r.ano)
    .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));
  const anosNumProventos = porAnoCompleto.map(row => parseInt(row.ano, 10)).filter(n => !isNaN(n));
  const anoAtualNum = new Date().getFullYear();
  const [anoInicioProventos, setAnoInicioProventos] = useState(anoAtualNum - (ANOS_PADRAO_HISTORICO - 1));

  if (!proventos?.length) return null;

  const totalRecebido = porAnoCompleto.reduce((s, r) => s + r.valor, 0);
  const porAno = porAnoCompleto.filter(d => parseInt(d.ano, 10) >= anoInicioProventos);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="proventos" />Proventos</h2>
        </SubCard>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar proventos" title="Editar proventos">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <SubCard style={{ overflow: "hidden" }}>
        <HeroValor titulo="Total recebido" valor={fmtBRL(totalRecebido)} visible={!!totalRecebido} />
        <div className="card-header" style={{ margin: "var(--space-2) 0" }}>
          <SeletorAno anos={anosNumProventos} anoInicio={anoInicioProventos} onChange={setAnoInicioProventos} />
        </div>
        <GraficoProventos porAno={porAno} />
      </SubCard>
    </Card>
  );
}

function HeatmapCell({ ativo, onSelectTicker }) {
  const [imgErr, setImgErr] = useState(false);
  const [hovered, setHovered] = useState(false);
  const pct    = toFloat(ativo.variacao_percentual);
  const varBRL = toFloat(ativo.variacao_total);
  const cor    = corHeatmap(pct);
  const s      = pct > 0 ? "+" : "";
  const sb     = varBRL > 0 ? "+" : "";
  const ticker = String(ativo.ticker).toUpperCase();

  return (
    <div
      className="heatmap-cell"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelectTicker?.(ativo.ticker)}
      title={`Ver ${ticker} na lista`}
      style={{
        background: cor,
        boxShadow: hovered ? `0 6px 24px ${cor}99, 0 2px 8px ${cor}55` : "none",
      }}
    >
      {!imgErr ? (
        <img src={`/logos/${ticker}.png`} alt={ticker}
          width={40} height={40}
          onError={() => setImgErr(true)}
          style={{ objectFit: "contain", borderRadius: 6 }} />
      ) : null}
      <span className="hm-ticker">{ticker}</span>
      <span className="hm-pct">{s}{pct.toFixed(2)}%</span>
      <span className="hm-brl">{sb}{fmtBRL(varBRL)}</span>
    </div>
  );
}

function CardHeatmap({ ativos, onSelectTicker }) {
  const [open, setOpen] = useState(false);
  if (!ativos?.length) return null;

  const df = ativos
    .filter(a => toFloat(a.total_atual) > 0)
    .sort((a, b) => toFloat(b.variacao_percentual) - toFloat(a.variacao_percentual));

  const LIMITE = 12;
  const temMais = df.length > LIMITE;

  return (
    <Card>
      <div className="card-header">
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="heatmap" />Mapa de ativos</h2>
        </SubCard>
        {temMais && (
          <BotaoVer onClick={() => setOpen(o => !o)} open={open} />
        )}
      </div>
      <SubCard>
        <div className="heatmap-grid">
          {df.slice(0, LIMITE).map((at, i) => <HeatmapCell key={i} ativo={at} onSelectTicker={onSelectTicker} />)}
        </div>
        {temMais && (
          <Expandable open={open}>
            <div className="heatmap-grid" style={{ marginTop: "var(--space-3)" }}>
              {df.slice(LIMITE).map((at, i) => <HeatmapCell key={i} ativo={at} onSelectTicker={onSelectTicker} />)}
            </div>
          </Expandable>
        )}
      </SubCard>
    </Card>
  );
}

function CardAtivo({ ativo, highlight, soMeta = false, titulo = null, sortBy = null, onEditar = null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (highlight) setOpen(true);
  }, [highlight]);

  const ehUSD = ["stock", "reit", "etf"].includes(String(ativo.classe).toLowerCase().trim());
  const cot   = toFloat(ativo.cotacao);
  const qtd   = toFloat(ativo.quantidade);
  const pm    = toFloat(ativo.preco_medio);
  const ti    = toFloat(ativo.total_investido);
  const ta    = toFloat(ativo.total_atual);
  const vt    = toFloat(ativo.variacao_total);
  const vpct  = toFloat(ativo.variacao_percentual);
  const vd    = toFloat(ativo.variacao_dia);
  const vdpct = toFloat(ativo.variacao_dia_percentual);
  const pmeta = toFloat(ativo.porcentagem_meta);
  const pat   = toFloat(ativo.porcentagem_atual);
  const psf   = toFloat(ativo.porcentagem_sobrando_faltando);

  const textoSF = psf > 0 ? "Sobrando" : psf < 0 ? "Faltando" : "Ok";
  const s   = sinal(vt);
  const sd  = sinalCompleto(vd);
  const ssf = sinalCompleto(psf);

  const metricas = soMeta
    ? [
        { titulo: "Atual", chave: "porcentagem_atual", valor: `${pat.toFixed(2)}%`,                  cor: null        },
        { titulo: "Meta",  chave: null,                 valor: `${pmeta.toFixed(2)}%`,               cor: null        },
        { titulo: textoSF, chave: null,                 valor: `${ssf}${Math.abs(psf).toFixed(2)}%`, cor: corVar(psf) },
      ]
    : [
        { titulo: "Cotação",         chave: null,                    valor: ehUSD ? fmtUSD(cot) : fmtBRL(cot), cor: null        },
        { titulo: "Variação do dia", chave: "variacao_dia",          valor: `${sd}${fmtBRL(Math.abs(vd))} (${sd}${Math.abs(vdpct).toFixed(2)}%)`, cor: corVar(vd) },
        { titulo: "Quantidade",      chave: null,                    valor: String(qtd),                         cor: null        },
        { titulo: "Preço médio",     chave: null,                    valor: ehUSD ? fmtUSD(pm) : fmtBRL(pm),   cor: null        },
        { titulo: "Total investido", chave: null,                    valor: fmtBRL(ti),                          cor: null        },
        { titulo: "Total atual",     chave: "total_atual",           valor: fmtBRL(ta),                          cor: null        },
        { titulo: "Variação",        chave: "variacao_total",        valor: `${s}${fmtBRL(vt)}`,                cor: corVar(vt)  },
        { titulo: "Variação %",      chave: "variacao_percentual",   valor: `${s}${vpct.toFixed(2)}%`,          cor: corVar(vt)  },
        { titulo: "% Meta",          chave: null,                    valor: `${pmeta.toFixed(2)}%`,             cor: null        },
        { titulo: "% Atual",         chave: "porcentagem_atual",     valor: `${pat.toFixed(2)}%`,               cor: null        },
        { titulo: textoSF,           chave: null,                    valor: `${ssf}${Math.abs(psf).toFixed(2)}%`, cor: corVar(psf) },
      ];

  return (
    <SubCard id={`ativo-${ativo.ticker}`} style={{
      overflow: "hidden",
      transition: "box-shadow 0.4s ease, border-color 0.4s ease",
      ...(highlight ? {
        boxShadow: "0 0 0 1px #13a097, 0 0 12px rgba(19,160,151,0.2)",
        borderColor: "#13a097",
      } : {}),
    }}>
      {titulo ? (
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">{titulo}</span>
          </div>
          <div className="list-row-right">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 0 }}>
              <span className="list-row-value">{String(ativo.ticker).toUpperCase()}</span>
              <span className="list-row-sub">{ativo.nome}</span>
            </div>
            <LogoAtivo ticker={ativo.ticker} size={36} />
          </div>
        </div>
      ) : (
        <>
          <div className={`ativo-cabecalho${sortBy === "nome" ? " ativo-cabecalho-filtrado" : ""}`} style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}>
            <LogoAtivo ticker={ativo.ticker} size={72} offsetX={-6} className="logo-ativo-principal" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ativo-nome-ticker">
                {String(ativo.ticker).toUpperCase()}
              </div>
              <div className="ativo-nome-texto">{ativo.nome}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              {onEditar && (
                <button className="btn-tema btn-tema-subcard" onClick={() => onEditar(ativo)} aria-label="Editar ativo" title="Editar ativo">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
                  </svg>
                </button>
              )}
              <BotaoVer onClick={() => setOpen(o => !o)} open={open} />
            </div>
          </div>

          <Expandable open={open}>
            <div className="divisor" />
            <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
              {metricas.map((m) => (
                <ListRow key={m.titulo} label={m.titulo} value={m.valor} valueColor={m.cor} plain highlight={!!m.chave && m.chave === sortBy} />
              ))}
            </div>
          </Expandable>
        </>
      )}

      {titulo && (
        <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
          {metricas.map((m) => (
            <ListRow key={m.titulo} label={m.titulo} value={m.valor} valueColor={m.cor} plain highlight={!!m.chave && m.chave === sortBy} />
          ))}
        </div>
      )}
    </SubCard>
  );
}

function CardClasse({ titulo, sufixo, classe, totais, ativos, selectedTicker, searchVersion, scrollRef, onEditarAtivo, onAdicionarAtivo }) {
  const [open, setOpen]               = useState(false);
  const [sortBy, setSortBy]           = useState(null);
  const [sortDir, setSortDir]         = useState("asc");
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [highlightTicker, setHighlightTicker] = useState(null);

  useEffect(() => {
    if (!selectedTicker || !searchVersion) return;
    const pertenceAessa = (ativos ?? []).some(a =>
      String(a.ticker) === selectedTicker &&
      String(a.classe).toLowerCase().trim() === classe
    );
    if (!pertenceAessa) return;

    const jaAberto = open;
    setOpen(true);
    setHighlightTicker(selectedTicker);

    const scrollToAtivo = () => {
      const el = document.getElementById(`ativo-${selectedTicker}`);
      const container = scrollRef?.current;
      if (el && container) {
        const containerRect = container.getBoundingClientRect();
        const elRect        = el.getBoundingClientRect();
        const offset        = container.scrollTop + elRect.top - containerRect.top - 110;
        container.scrollTo({ top: offset, behavior: "smooth" });
      }
      setTimeout(() => setHighlightTicker(null), 2000);
    };

    let t;
    if (jaAberto) {
      scrollToAtivo();
    } else {
      const secEl = document.getElementById(`sec-${sufixo}`);
      const container = scrollRef?.current;
      if (secEl && container) {
        const containerRect = container.getBoundingClientRect();
        const secRect       = secEl.getBoundingClientRect();
        container.scrollTo({ top: container.scrollTop + secRect.top - containerRect.top - 110, behavior: "smooth" });
      }
      t = setTimeout(scrollToAtivo, 550);
    }

    return () => clearTimeout(t);
  }, [searchVersion]);

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir(key === "nome" ? "asc" : "desc");
    }
  };

  if (!totais?.length) return null;
  const t = totais[0];

  const total    = toFloat(t[`total_${sufixo}`]);
  const aportado = toFloat(t[`total_aportado_${sufixo}`]);
  const diff     = toFloat(t[`diferenca_${sufixo}`]);
  const totalOntem = toFloat(t[`total_ontem_${sufixo}`]);
  const diffDia     = toFloat(t[`diferenca_dia_${sufixo}`]);
  const diffDiaPct  = totalOntem > 0 ? (diffDia / totalOntem) * 100 : 0;

  let df = (ativos ?? []).filter(a => String(a.classe).toLowerCase().trim() === classe);
  if (sortBy) {
    df = [...df].sort((a, b) => {
      const va = sortBy === "nome" ? String(a[sortBy]) : toFloat(a[sortBy]);
      const vb = sortBy === "nome" ? String(b[sortBy]) : toFloat(b[sortBy]);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const corDiff = corVar(diff);
  const corDiffDia = corVar(diffDia);
  const pctVariacao = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;

  return (
    <Card>
      <div className="card-header">
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">
            <IconeCard nome={ICONE_POR_SUFIXO[sufixo]} />{titulo}
            <span className="card-titulo-contador">{df.length}</span>
          </h2>
        </SubCard>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button className="btn-tema" onClick={() => onAdicionarAtivo(classe)} aria-label={`Adicionar ${titulo}`} title={`Adicionar ${titulo}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <BotaoVer onClick={() => setOpen(o => !o)} open={open} />
        </div>
      </div>

      <SubCard>

        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        <ListRow label="Aportado" value={fmtBRL(aportado)} plain />

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label="Variação"
              value={`${sinalCompleto(diff)}${fmtBRL(Math.abs(diff))} (${pctVariacao.toFixed(1)}%)`}
              valueColor={corDiff}
              plain
            />
            <ListRow
              label="Variação do dia"
              value={`${sinalCompleto(diffDia)}${fmtBRL(Math.abs(diffDia))} (${sinalCompleto(diffDiaPct)}${Math.abs(diffDiaPct).toFixed(2)}%)`}
              valueColor={corDiffDia}
              plain
            />
          </div>
        </div>
      </SubCard>

      <Expandable open={open}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

          <div className="dropdown-wrap filtro-botao-mobile">
            <BotaoFiltroTrigger
              open={filtrosOpen}
              onClick={() => setFiltrosOpen(o => !o)}
            >
              {sortBy && (
                <span className="dropdown-trigger-sub">
                  {FILTROS.find(f => f.key === sortBy)?.texto}
                </span>
              )}
            </BotaoFiltroTrigger>

            {filtrosOpen && (
              <div className="dropdown-menu">
                {FILTROS.map(f => {
                  const ativo = sortBy === f.key;
                  return (
                    <button
                      key={f.key}
                      className={`dropdown-item${ativo ? " is-ativo" : ""}`}
                      onClick={() => { handleSort(f.key); setFiltrosOpen(false); }}
                    >
                      {f.texto}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="filtros-row filtro-botao-desktop">
            {FILTROS.map(f => {
              const ativo = sortBy === f.key;
              return (
                <BotaoFiltro
                  key={f.key}
                  ativo={ativo}
                  onClick={() => handleSort(f.key)}
                >
                  {f.texto}
                </BotaoFiltro>
              );
            })}
          </div>
          <div className="ativos-lista">
            {df.map((at, i) => <CardAtivo key={i} ativo={at} highlight={at.ticker === highlightTicker} sortBy={sortBy} onEditar={onEditarAtivo} />)}
          </div>
        </div>
      </Expandable>
    </Card>
  );
}

function CardResumoCotacoes({ ativos }) {
  if (!ativos?.length) return null;

  const totalHoje  = ativos.reduce((s, a) => s + toFloat(a.total_atual), 0);
  const totalOntem = ativos.reduce((s, a) => s + toFloat(a.total_atual_ontem), 0);
  const variacaoDia = totalHoje - totalOntem;
  const variacaoDiaPercentual = totalOntem > 0 ? (variacaoDia / totalOntem) * 100 : 0;

  const corDiff = corVar(variacaoDia);

  const porClasse = {};
  ativos.forEach(a => {
    const classe = String(a.classe ?? "").toLowerCase().trim();
    if (!porClasse[classe]) porClasse[classe] = { hoje: 0, ontem: 0 };
    porClasse[classe].hoje  += toFloat(a.total_atual);
    porClasse[classe].ontem += toFloat(a.total_atual_ontem);
  });

  let melhorClasse = null, melhorPct = -Infinity;
  let piorClasse = null, piorPct = Infinity;
  Object.entries(porClasse).forEach(([classe, v]) => {
    if (v.ontem > 0) {
      const pct = ((v.hoje - v.ontem) / v.ontem) * 100;
      if (pct > melhorPct) { melhorPct = pct; melhorClasse = classe; }
      if (pct < piorPct)  { piorPct  = pct; piorClasse  = classe; }
    }
  });

  const tituloMelhorClasse = CLASSES_ATIVOS.find(c => c.classe === melhorClasse)?.titulo ?? melhorClasse;
  const temMelhorClasse = melhorClasse != null && Number.isFinite(melhorPct);

  const tituloPiorClasse = CLASSES_ATIVOS.find(c => c.classe === piorClasse)?.titulo ?? piorClasse;
  const temPiorClasse = piorClasse != null && Number.isFinite(piorPct) && piorClasse !== melhorClasse;

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo"><IconeCard nome="cotacoes" />Cotações</h2>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Carteira hoje</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(totalHoje)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label="Variação no dia"
              value={`${sinalCompleto(variacaoDia)}${fmtBRL(Math.abs(variacaoDia))} (${sinalCompleto(variacaoDiaPercentual)}${Math.abs(variacaoDiaPercentual).toFixed(2)}%)`}
              valueColor={corDiff}
              plain
            />
            {temMelhorClasse && (
              <ListRow
                label="Melhor classe do dia"
                value={`${tituloMelhorClasse} (${sinalCompleto(melhorPct)}${Math.abs(melhorPct).toFixed(2)}%)`}
                valueColor={corVar(melhorPct)}
                plain
              />
            )}
            {temPiorClasse && (
              <ListRow
                label="Pior classe do dia"
                value={`${tituloPiorClasse} (${sinalCompleto(piorPct)}${Math.abs(piorPct).toFixed(2)}%)`}
                valueColor={corVar(piorPct)}
                plain
              />
            )}
          </div>
        </div>
      </SubCard>
    </Card>
  );
}

function LinhaCotacao({ ativo, highlight }) {
  const ehUSD = CLASSES_EM_DOLAR.includes(String(ativo.classe).toLowerCase().trim());
  const formatar = ehUSD ? fmtUSD : fmtBRL;

  const cotacao      = toFloat(ativo.cotacao);
  const variacao      = toFloat(ativo.variacao_cotacao);
  const variacaoPct   = toFloat(ativo.variacao_cotacao_percentual);
  const cor = corVar(variacao);
  const s   = sinalCompleto(variacao);

  const link = linkGoogleFinance(ativo.ticker, ativo.classe);

  const abrirNoGoogleFinance = () => {
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="list-row list-row-plain list-row-clickable"
      id={`cotacao-${ativo.ticker}`}
      onClick={abrirNoGoogleFinance}
      title={`Ver ${String(ativo.ticker).toUpperCase()} no Google Finance`}
      style={{
        transition: "box-shadow 0.4s ease, border-radius 0.4s ease",
        ...(highlight ? {
          boxShadow: "0 0 0 1px #13a097, 0 0 12px rgba(19,160,151,0.2)",
          borderRadius: "var(--radius-md)",
        } : {}),
      }}
    >
      <div className="list-row-left" style={{ gap: "var(--space-3)" }}>
        <LogoAtivo ticker={ativo.ticker} size={36} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="list-row-label">{String(ativo.ticker).toUpperCase()}</span>
          <span className="list-row-tag">{ativo.nome}</span>
        </div>
      </div>
      <div className="list-row-right">
        <div className="list-row-values">
          <span className="list-row-value">{formatar(cotacao)}</span>
          <span className="list-row-sub" style={{ color: cor, fontSize: 13, fontWeight: 600 }}>
            {s}{formatar(Math.abs(variacao))} ({s}{Math.abs(variacaoPct).toFixed(2)}%)
          </span>
        </div>
      </div>
    </div>
  );
}

const FILTROS_COTACAO = [
  { texto: "Maior alta",          key: "valorizadas"    },
  { texto: "Maior baixa",         key: "desvalorizadas" },
];

function variacaoPctAssinada(a) {
  const v = toFloat(a.variacao_cotacao);
  const p = Math.abs(toFloat(a.variacao_cotacao_percentual));
  return v < 0 ? -p : p;
}

function CardCotacoesClasse({ titulo, sufixo, classe, ativos, selectedTicker, searchVersion, scrollRef }) {
  const [open, setOpen]   = useState(false);
  const [ordem, setOrdem] = useState(null);
  const [highlightTicker, setHighlightTicker] = useState(null);

  const handleOrdem = (key) => setOrdem(o => (o === key ? null : key));

  useEffect(() => {
    if (!selectedTicker || !searchVersion) return;
    const pertenceAessa = (ativos ?? []).some(a =>
      String(a.ticker) === selectedTicker &&
      String(a.classe).toLowerCase().trim() === classe
    );
    if (!pertenceAessa) return;

    const jaAberto = open;
    setOpen(true);
    setHighlightTicker(selectedTicker);

    const scrollToAtivo = () => {
      const el = document.getElementById(`cotacao-${selectedTicker}`);
      const container = scrollRef?.current;
      if (el && container) {
        const containerRect = container.getBoundingClientRect();
        const elRect        = el.getBoundingClientRect();
        const offset        = container.scrollTop + elRect.top - containerRect.top - 110;
        container.scrollTo({ top: offset, behavior: "smooth" });
      }
      setTimeout(() => setHighlightTicker(null), 2000);
    };

    let t;
    if (jaAberto) {
      scrollToAtivo();
    } else {
      const secEl = document.getElementById(`sec-cotacao-${sufixo}`);
      const container = scrollRef?.current;
      if (secEl && container) {
        const containerRect = container.getBoundingClientRect();
        const secRect       = secEl.getBoundingClientRect();
        container.scrollTo({ top: container.scrollTop + secRect.top - containerRect.top - 110, behavior: "smooth" });
      }
      t = setTimeout(scrollToAtivo, 550);
    }

    return () => clearTimeout(t);
  }, [searchVersion]);

  const df = (ativos ?? [])
    .filter(a => String(a.classe).toLowerCase().trim() === classe)
    .sort((a, b) => {
      if (ordem) {
        const diff = variacaoPctAssinada(b) - variacaoPctAssinada(a);
        if (diff !== 0) return ordem === "valorizadas" ? diff : -diff;
      }
      return String(a.ticker).localeCompare(String(b.ticker));
    });

  if (!df.length) return null;

  return (
    <Card>
      <div className="card-header">
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">
            <IconeCard nome={ICONE_POR_SUFIXO[sufixo]} />{titulo}
            <span className="card-titulo-contador">{df.length}</span>
          </h2>
        </SubCard>
        <BotaoVer onClick={() => setOpen(o => !o)} open={open} />
      </div>

      <Expandable open={open}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="filtros-row">
            {FILTROS_COTACAO.map(f => (
              <BotaoFiltro
                key={f.key}
                ativo={ordem === f.key}
                onClick={() => handleOrdem(f.key)}
              >
                {f.texto}
              </BotaoFiltro>
            ))}
          </div>

          <SubCard>
            <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
              {df.map(a => <LinhaCotacao key={a.ticker} ativo={a} highlight={a.ticker === highlightTicker} />)}
            </div>
          </SubCard>
        </div>
      </Expandable>
    </Card>
  );
}

async function carregarLancamentos() {
  try {
    const snapshot = await get(ref(db, "financas"));
    const data = snapshot.val();
    if (!data || typeof data !== "object") return { transactions: [], metaDespesa: 0 };
    return {
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      metaDespesa: Number(data.metaDespesa) || 0,
    };
  } catch (err) {
    console.error("Erro ao carregar lançamentos:", err);
    return { transactions: [], metaDespesa: 0 };
  }
}

async function salvarLancamentos(transactions, metaDespesa) {
  try {
    await set(ref(db, "financas"), { transactions, metaDespesa });
  } catch (err) {
    console.error("Erro ao salvar lançamentos:", err);
  }
}

function CardFinancasResumo({ totais, meta, gasto, onEditarMeta }) {
  const corNet = corVar(totais.net);

  const restante = meta - gasto;
  const excedeu  = meta > 0 && gasto > meta;
  const pct      = meta > 0 ? Math.min((gasto / meta) * 100, 100) : 0;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="financas" />Finanças</h2>
        </SubCard>
        <button className="btn-tema" onClick={onEditarMeta} aria-label={meta > 0 ? "Editar meta" : "Definir meta"} title={meta > 0 ? "Editar meta" : "Definir meta"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
          </svg>
        </button>
      </div>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Total líquido</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value" style={{ color: corNet }}>{`${sinalCompleto(totais.net)}${fmtBRL(Math.abs(totais.net))}`}</span>
          </div>
        </div>

        <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
          <ListRow
            label="Receitas totais"
            value={`+${fmtBRL(totais.income)}`}
            valueColor={COR_ALTA}
            plain
          />
          <ListRow
            label="Despesas totais"
            value={`-${fmtBRL(totais.expense)}`}
            valueColor={COR_BAIXA}
            plain
          />
        </div>
      </SubCard>

      <SubCard>
        <div className="card-header" style={{ marginBottom: meta > 0 ? "var(--space-2)" : 0 }}>
          <span className="campo-titulo">{meta > 0 ? "Progresso do mês" : "Nenhuma meta definida"}</span>
        </div>

        {meta > 0 ? (
          <>
            <BarraSimples pct={pct} cor={excedeu ? COR_BAIXA : COR_ALTA} />
            <div style={{ marginTop: "var(--space-3)", marginBottom: "calc(var(--space-4) * -1)" }}>
              <ListRow label="Meta definida" value={fmtBRL(meta)} plain />
              <ListRow label="Já gasto" value={`-${fmtBRL(gasto)}`} valueColor={excedeu ? COR_BAIXA : undefined} plain />
              <ListRow
                label={excedeu ? "Ultrapassou em" : "Ainda pode gastar"}
                value={`${sinalCompleto(restante)}${fmtBRL(Math.abs(restante))}`}
                valueColor={excedeu ? COR_BAIXA : COR_ALTA}
                plain
              />
            </div>
          </>
        ) : (
          <div className="campo-titulo">Defina um limite mensal para acompanhar seus gastos.</div>
        )}
      </SubCard>
    </Card>
  );
}

function CardFinancasComparativo({ lancamentos, onEditar, onAdicionar }) {
  const receitas = lancamentos.filter(t => t.type === "income");

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="seta-cima" />Receitas</h2>
        </SubCard>
        <button className="btn-tema" onClick={() => onAdicionar("income")} aria-label="Adicionar receita" title="Adicionar receita">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {receitas.length === 0 ? (
        <SubCard>
          <div className="campo-titulo">Nenhuma receita cadastrada ainda.</div>
        </SubCard>
      ) : (
        <SubCard>
          <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
            {receitas.map(tx => (
              <div
                key={tx.id}
                className="list-row list-row-plain list-row-clickable"
                onClick={() => onEditar(tx)}
                title={`Editar ${sentenceCase(tx.name)}`}
              >
                <div className="list-row-left">
                  <span className="list-row-label">{sentenceCase(tx.name)}</span>
                </div>
                <div className="list-row-right">
                  <span className="list-row-value" style={{ color: COR_ALTA }}>
                    +{fmtBRL(tx.value)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SubCard>
      )}
    </Card>
  );
}

function CardFinancasMeta({ lancamentos, onEditarLancamento, onAdicionar }) {
  const despesas = lancamentos.filter(t => t.type === "expense");

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="seta-baixo" />Despesas</h2>
        </SubCard>
        <button className="btn-tema" onClick={() => onAdicionar("expense")} aria-label="Adicionar despesa" title="Adicionar despesa">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {despesas.length === 0 ? (
        <SubCard>
          <div className="campo-titulo">Nenhuma despesa cadastrada ainda.</div>
        </SubCard>
      ) : (
        <SubCard>
          <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
            {despesas.map(tx => (
              <div
                key={tx.id}
                className="list-row list-row-plain list-row-clickable"
                onClick={() => onEditarLancamento(tx)}
                title={`Editar ${sentenceCase(tx.name)}`}
              >
                <div className="list-row-left">
                  <span className="list-row-label">{sentenceCase(tx.name)}</span>
                </div>
                <div className="list-row-right">
                  <span className="list-row-value" style={{ color: COR_BAIXA }}>
                    -{fmtBRL(tx.value)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SubCard>
      )}
    </Card>
  );
}

function ModalFinancas({ titulo, onFechar, children, className }) {
  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div className={`modal-sheet${className ? ` ${className}` : ""}`}>
        <div className="modal-header">
          <h3 className="modal-titulo">{titulo}</h3>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function ModalLancamento({ form, editando, onChange, onSalvar, onExcluir, onFechar, formatarValor }) {
  const tipoClasse = form.type === "expense" ? "tipo-despesa" : "tipo-receita";

  return (
    <ModalFinancas titulo={editando ? "Editar lançamento" : "Novo lançamento"} onFechar={onFechar} className={tipoClasse}>
      <div className="tipo-toggle">
        <button
          className={`tipo-opcao${form.type === "income" ? " tipo-opcao-ativa income" : ""}`}
          onClick={() => onChange({ ...form, type: "income" })}
        >
          Receita
        </button>
        <button
          className={`tipo-opcao${form.type === "expense" ? " tipo-opcao-ativa expense" : ""}`}
          onClick={() => onChange({ ...form, type: "expense" })}
        >
          Despesa
        </button>
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Descrição</label>
        <input
          className="form-input"
          placeholder="Ex: salário, aluguel..."
          value={form.name}
          onChange={e => onChange({ ...form, name: e.target.value })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Valor (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={form.value}
          onChange={e => onChange({ ...form, value: formatarValor(e.target.value) })}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>
        {editando ? "Salvar alterações" : "Adicionar lançamento"}
      </button>

      {editando && (
        <button className="form-botao form-botao-perigo" onClick={onExcluir}>
          Excluir Lançamento
        </button>
      )}
    </ModalFinancas>
  );
}

function ModalMeta({ valor, onChange, onSalvar, onLimpar, temMeta, onFechar }) {
  return (
    <ModalFinancas titulo="Meta de gastos" onFechar={onFechar}>
      <div className="form-grupo">
        <label className="campo-titulo">Valor da meta (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={e => onChange(e.target.value)}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>Salvar meta</button>

      {temMeta && (
        <button className="form-botao form-botao-secundario" onClick={onLimpar}>
          Remover Meta
        </button>
      )}
    </ModalFinancas>
  );
}

function ModalAtivo({ ticker, form, onChange, onSalvar, onLimpar, temDados, onFechar, isNovo }) {
  const precoEmDolar = ehClasseEmDolar(form.classe);

  function trocarClasse(novaClasse) {
    const valor = parseMoedaInput(form.preco_medio, form.classe);
    onChange({
      ...form,
      classe: novaClasse,
      preco_medio: valor ? numParaMoedaInput(valor, novaClasse) : "",
    });
  }

  return (
    <ModalFinancas titulo={isNovo ? "Novo ativo" : `Editar ${String(ticker).toUpperCase()}`} onFechar={onFechar}>
      <div className="form-grupo">
        <label className="campo-titulo">Ticker</label>
        <input
          className="form-input"
          placeholder="Ex: AAPL"
          value={form.ticker}
          onChange={e => onChange({ ...form, ticker: e.target.value.toUpperCase() })}
        />
        {!isNovo && form.ticker.trim().toUpperCase() !== String(ticker).toUpperCase() && (
          <span style={{ fontSize: 12, color: "var(--color-label)", marginTop: 4, display: "block" }}>
            Ao salvar, os dados deste ativo serão movidos de {String(ticker).toUpperCase()} para {form.ticker.trim().toUpperCase() || "—"}.
            Lembre-se de usar exatamente o mesmo ticker que está na planilha.
          </span>
        )}
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Nome</label>
        <input
          className="form-input"
          placeholder="Ex: Apple Inc."
          value={form.nome}
          onChange={e => onChange({ ...form, nome: e.target.value })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Classe</label>
        <SeletorForm
          value={form.classe}
          onChange={trocarClasse}
          options={CLASSES_ATIVOS.map(c => ({ value: c.classe, label: c.titulo }))}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Quantidade</label>
        <input
          className="form-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={form.quantidade}
          onChange={e => onChange({ ...form, quantidade: e.target.value })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Preço médio ({precoEmDolar ? "US$" : "R$"})</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder={precoEmDolar ? "0.00" : "0,00"}
          value={form.preco_medio}
          onChange={e => onChange({ ...form, preco_medio: formatarMoedaInput(e.target.value, form.classe) })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">% Meta (dentro da classe)</label>
        <input
          className="form-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={form.porcentagem_meta}
          onChange={e => onChange({ ...form, porcentagem_meta: e.target.value })}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>{isNovo ? "Adicionar ativo" : "Salvar alterações"}</button>

      {temDados && (
        <button className="form-botao form-botao-perigo" onClick={onLimpar}>
          Remover cadastro deste ativo
        </button>
      )}
    </ModalFinancas>
  );
}

function ModalReserva({ valor, onChangeValor, onSalvar, onFechar }) {
  return (
    <ModalFinancas titulo="Editar reserva" onFechar={onFechar}>
      <div className="form-grupo">
        <label className="campo-titulo">Valor atual da reserva (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={e => onChangeValor(e.target.value)}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>Salvar reserva</button>
    </ModalFinancas>
  );
}

function ModalListaAnos({ titulo, campos, linhas, onChange, onSalvar, onFechar }) {
  function atualizarLinha(i, campo, valor) {
    const novas = linhas.slice();
    novas[i] = { ...novas[i], [campo]: valor };
    onChange(novas);
  }

  function removerLinha(i) {
    onChange(linhas.filter((_, idx) => idx !== i));
  }

  function adicionarLinha() {
    const anoAtual = new Date().getFullYear();
    const anosExistentes = linhas.map(l => parseInt(l.ano, 10)).filter(n => !isNaN(n));
    const proximoAno = anosExistentes.length ? Math.max(...anosExistentes) + 1 : anoAtual;
    const nova = { ano: String(proximoAno) };
    campos.forEach(c => { nova[c.key] = ""; });
    onChange([...linhas, nova]);
  }

  return (
    <ModalFinancas titulo={titulo} onFechar={onFechar}>
      <div className="lista-anos-wrap">
        {linhas.map((linha, i) => (
          <div key={i} className="lista-anos-linha">
            <div className="lista-anos-linha-header">
              <div className="form-grupo lista-anos-ano">
                <label className="campo-titulo">Ano</label>
                <input
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex: 2024"
                  value={linha.ano ?? ""}
                  onChange={e => atualizarLinha(i, "ano", e.target.value)}
                />
              </div>
              {campos.map(c => (
                <div className="form-grupo lista-anos-valor" key={c.key}>
                  <label className="campo-titulo">{c.label}</label>
                  <input
                    className="form-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={linha[c.key] ?? ""}
                    onChange={e => atualizarLinha(i, c.key, formatarBRLInput(e.target.value))}
                  />
                </div>
              ))}
              <button
                className="btn-remover-linha"
                onClick={() => removerLinha(i)}
                aria-label="Remover ano"
                title="Remover ano"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        {linhas.length === 0 && (
          <div className="lista-anos-vazio">Nenhum ano cadastrado ainda.</div>
        )}
      </div>

      <button className="form-botao form-botao-secundario" onClick={adicionarLinha}>+ Adicionar ano</button>
      <button className="form-botao" onClick={onSalvar}>Salvar</button>
    </ModalFinancas>
  );
}

function ModalMetasAlocacao({ form, onChange, onSalvar, onFechar }) {
  return (
    <ModalFinancas titulo="Metas de alocação" onFechar={onFechar}>
      <div className="lista-anos-wrap">
        {ALOCACAO_CLASSES.map(c => (
          <div className="lista-anos-linha" key={c.sufixo}>
            <div className="form-grupo">
              <label className="campo-titulo">Definir meta para {c.titulo}</label>
              <input
                className="form-input input-meta-alocacao"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={form[c.sufixo] ?? ""}
                onChange={e => onChange({ ...form, [c.sufixo]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <button className="form-botao" onClick={onSalvar}>Salvar metas</button>
    </ModalFinancas>
  );
}

function PaginaFinancas({ lancamentos, setLancamentos, metaDespesa, setMetaDespesa }, ref) {
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoId, setEditandoId]   = useState(null);
  const [form, setForm]               = useState({ name: "", value: "", type: "income" });

  const [modalMetaAberto, setModalMetaAberto] = useState(false);
  const [metaInput, setMetaInput]             = useState("");

  const totais = {
    income:  lancamentos.filter(t => t.type === "income" ).reduce((s, t) => s + t.value, 0),
    expense: lancamentos.filter(t => t.type === "expense").reduce((s, t) => s + t.value, 0),
  };
  totais.net = totais.income - totais.expense;

  function formatarBRL(raw) {
    const digitos = raw.replace(/\D/g, "");
    if (!digitos) return "";
    const centavos = parseInt(digitos, 10);
    return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseBRL(formatado) {
    return parseFloat(formatado.replace(/\./g, "").replace(",", ".")) || 0;
  }

  function abrirNovoLancamento(tipo = "income") {
    setEditandoId(null);
    setForm({ name: "", value: "", type: tipo });
    setModalAberto(true);
  }

  useImperativeHandle(ref, () => ({
    abrirNovoLancamento,
  }));

  function abrirEdicaoLancamento(tx) {
    setEditandoId(tx.id);
    const formatado = tx.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setForm({ name: tx.name, value: formatado, type: tx.type });
    setModalAberto(true);
  }

  function salvarLancamento() {
    const valor = parseBRL(form.value);
    if (!form.name.trim() || isNaN(valor) || valor <= 0) return;

    if (editandoId !== null) {
      setLancamentos(prev => prev.map(t =>
        t.id === editandoId ? { ...t, name: form.name.trim(), value: valor, type: form.type } : t
      ));
    } else {
      setLancamentos(prev => [{ id: Date.now(), name: form.name.trim(), value: valor, type: form.type }, ...prev]);
    }
    setModalAberto(false);
  }

  function excluirLancamento() {
    if (editandoId == null) return;
    setLancamentos(prev => prev.filter(t => t.id !== editandoId));
    setModalAberto(false);
  }

  function abrirModalMeta() {
    setMetaInput(metaDespesa > 0 ? metaDespesa.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
    setModalMetaAberto(true);
  }

  function salvarMeta() {
    const valor = parseBRL(metaInput);
    setMetaDespesa(isNaN(valor) || valor < 0 ? 0 : valor);
    setModalMetaAberto(false);
  }

  function limparMeta() {
    setMetaDespesa(0);
    setModalMetaAberto(false);
  }

  return (
    <>
      <div id="sec-financas-resumo">
        <CardFinancasResumo totais={totais} meta={metaDespesa} gasto={totais.expense} onEditarMeta={abrirModalMeta} />
      </div>
      <div id="sec-financas-comparativo">
        <CardFinancasComparativo lancamentos={lancamentos} onEditar={abrirEdicaoLancamento} onAdicionar={abrirNovoLancamento} />
      </div>
      <div id="sec-financas-meta">
        <CardFinancasMeta
          lancamentos={lancamentos}
          onEditarLancamento={abrirEdicaoLancamento}
          onAdicionar={abrirNovoLancamento}
        />
      </div>

      {modalAberto && (
        <ModalLancamento
          form={form}
          editando={editandoId !== null}
          onChange={setForm}
          onSalvar={salvarLancamento}
          onExcluir={excluirLancamento}
          onFechar={() => setModalAberto(false)}
          formatarValor={formatarBRL}
        />
      )}

      {modalMetaAberto && (
        <ModalMeta
          valor={metaInput}
          onChange={v => setMetaInput(formatarBRL(v))}
          onSalvar={salvarMeta}
          onLimpar={limparMeta}
          temMeta={metaDespesa > 0}
          onFechar={() => setModalMetaAberto(false)}
        />
      )}
    </>
  );
}

PaginaFinancas = forwardRef(PaginaFinancas);

function numParaTexto(n) {
  if (!n) return "";
  return String(n).replace(".", ",");
}

function numParaBRLInput(n) {
  const v = toFloat(n);
  if (!v) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numParaMoedaInput(n, classe) {
  const v = toFloat(n);
  if (!v) return "";
  const locale = ehClasseEmDolar(classe) ? "en-US" : "pt-BR";
  return v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function App() {
  const [dadosPlanilha, setDadosPlanilha] = useState(null);
  const [dadosLocais, setDadosLocais]     = useState(() => carregarDadosLocais());
  const [loading, setLoading]       = useState(true);
  const [erro, setErro]             = useState(null);
  const [scrolled, setScrolled]     = useState(false);
  const [tema, setTema] = useState(() => {
    if (typeof window === "undefined") return "dark";
    let salvo = "dark";
    try {
      salvo = localStorage.getItem("valueup_tema") || "dark";
    } catch {}
    document.documentElement.setAttribute("data-theme", salvo);
    return salvo;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    try {
      localStorage.setItem("valueup_tema", tema);
    } catch {}
  }, [tema]);

  const alternarTema = useCallback(() => {
    setTema(t => (t === "dark" ? "light" : "dark"));
  }, []);
  const [searchCmd, setSearchCmd] = useState(null);
  const [pagina, setPagina]         = useState("patrimonio");
  const [lancamentos, setLancamentos] = useState([]);
  const [metaDespesa, setMetaDespesa] = useState(0);
  const scrollRef = useRef(null);
  const financasRef = useRef(null);
  const nuvemOkRef = useRef(false);

  const [ativoEditando, setAtivoEditando] = useState(null);
  const [formAtivo, setFormAtivo]         = useState({ ticker: "", nome: "", classe: "", quantidade: "", preco_medio: "", porcentagem_meta: "", cotacao: "" });

  const [reservaModalAberto, setReservaModalAberto] = useState(false);
  const [formReserva, setFormReserva]                 = useState("");

  const [metasModalAberto, setMetasModalAberto] = useState(false);
  const [formMetas, setFormMetas]                 = useState({});

  const [proventosModalAberto, setProventosModalAberto] = useState(false);
  const [formProventos, setFormProventos]                 = useState([]);

  const [evolucaoModalAberto, setEvolucaoModalAberto] = useState(false);
  const [formEvolucao, setFormEvolucao]                 = useState([]);

  const irParaPagina = useCallback((p) => {
    setPagina(p);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    async function carregarSeed(url, campo, vazio) {
      if (!vazio(dadosLocais[campo])) return;
      try {
        const r = await fetch(url);
        if (!r.ok) return;
        const seed = await r.json();
        setDadosLocais(prev => (vazio(prev[campo]) ? { ...prev, [campo]: seed } : prev));
      } catch {

      }
    }
    carregarSeed(SEED_ATIVOS_URL,    "ativos",    v => Object.keys(v ?? {}).length === 0);
    carregarSeed(SEED_PROVENTOS_URL, "proventos", v => (v ?? []).length === 0);
    carregarSeed(SEED_EVOLUCAO_URL,  "evolucao",  v => (v ?? []).length === 0);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [planilha, financas, dadosNuvem] = await Promise.all([
          carregarPlanilha(),
          carregarLancamentos(),
          carregarDadosLocaisNuvem(),
        ]);
        setDadosPlanilha(planilha);
        setLancamentos(financas.transactions);
        setMetaDespesa(financas.metaDespesa);

        if (dadosNuvem !== null)
          nuvemOkRef.current = true;
        if (dadosNuvem && Object.keys(dadosNuvem).length > 0) {
          setDadosLocais(normalizarDadosLocais(dadosNuvem));
        }
      } catch (e) {
        setErro(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    salvarLancamentos(lancamentos, metaDespesa);
  }, [lancamentos, metaDespesa, loading]);

  useEffect(() => {
    salvarDadosLocais(dadosLocais);
    if (loading)
      return;
    if (!nuvemOkRef.current)
      return;
    salvarDadosLocaisNuvem(dadosLocais);
  }, [dadosLocais, loading]);

  useEffect(() => {
    let ocupado = false;
    async function sincronizar() {
      if (document.visibilityState !== "visible" || ocupado) return;
      ocupado = true;
      try {
        const [dadosNuvem, planilha] = await Promise.all([
          carregarDadosLocaisNuvem(),
          carregarPlanilha().catch(() => null),
        ]);
        if (planilha) setDadosPlanilha(planilha);
        if (dadosNuvem !== null) {
          nuvemOkRef.current = true;
          if (Object.keys(dadosNuvem).length > 0) {
            const novo = normalizarDadosLocais(dadosNuvem);
            setDadosLocais(prev => (JSON.stringify(prev) === JSON.stringify(novo) ? prev : novo));
          }
        }
      } finally {
        ocupado = false;
      }
    }
    document.addEventListener("visibilitychange", sincronizar);
    window.addEventListener("focus", sincronizar);
    window.addEventListener("online", sincronizar);
    return () => {
      document.removeEventListener("visibilitychange", sincronizar);
      window.removeEventListener("focus", sincronizar);
      window.removeEventListener("online", sincronizar);
    };
  }, []);

  const handleScroll = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop || 0;
    setScrolled(scrollTop > 10);
  }, []);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  function abrirEdicaoAtivo(ativo) {
    const extra = buscarExtraAtivo(dadosLocais.ativos, ativo.ticker);
    setFormAtivo({
      ticker: ativo.ticker,
      nome: extra.nome ?? "",
      classe: extra.classe ?? "",
      quantidade: numParaTexto(extra.quantidade),
      preco_medio: numParaMoedaInput(extra.preco_medio, extra.classe),
      porcentagem_meta: numParaTexto(extra.porcentagem_meta),
      cotacao: numParaTexto(extra.cotacao),
    });
    setAtivoEditando(ativo.ticker);
  }

  function abrirNovoAtivo(classePreSelecionada) {
    setFormAtivo({
      ticker: "",
      nome: "",
      classe: classePreSelecionada ?? "",
      quantidade: "",
      preco_medio: "",
      porcentagem_meta: "",
      cotacao: "",
    });
    setAtivoEditando(NOVO_ATIVO_MARCADOR);
  }

  function salvarAtivo() {
    if (!ativoEditando) return;
    const isNovo = ativoEditando === NOVO_ATIVO_MARCADOR;
    const novoTicker = formAtivo.ticker.trim().toLowerCase() || (isNovo ? "" : String(ativoEditando).toLowerCase());
    if (!novoTicker)
      return;

    setDadosLocais(prev => {
      const ativos = { ...prev.ativos };
      if (!isNovo) {
        const chaveAntiga = Object.keys(ativos).find(
          k => k.toLowerCase() === String(ativoEditando).toLowerCase()
        );
        if (chaveAntiga && chaveAntiga !== novoTicker) {
          delete ativos[chaveAntiga];
        }
      }
      ativos[novoTicker] = {
        nome: formAtivo.nome.trim(),
        classe: formAtivo.classe,
        quantidade: toFloat(formAtivo.quantidade),
        preco_medio: parseMoedaInput(formAtivo.preco_medio, formAtivo.classe),
        porcentagem_meta: toFloat(formAtivo.porcentagem_meta),
        cotacao: toFloat(formAtivo.cotacao),
      };
      return { ...prev, ativos };
    });
    setAtivoEditando(null);
  }

  function limparAtivo() {
    if (!ativoEditando || ativoEditando === NOVO_ATIVO_MARCADOR) {
      setAtivoEditando(null);
      return;
    }
    setDadosLocais(prev => {
      const ativos = { ...prev.ativos };
      const chave = Object.keys(ativos).find(
        k => k.toLowerCase() === String(ativoEditando).toLowerCase()
      );
      if (chave) delete ativos[chave];
      return { ...prev, ativos };
    });
    setAtivoEditando(null);
  }

  function abrirEdicaoReserva() {
    setFormReserva(numParaBRLInput(dadosLocais.reserva_atual));
    setReservaModalAberto(true);
  }

  function salvarReserva() {
    setDadosLocais(prev => ({
      ...prev,
      reserva_atual: parseBRLInput(formReserva),
    }));
    setReservaModalAberto(false);
  }

  function abrirEdicaoMetas() {
    const form = {};
    ALOCACAO_CLASSES.forEach(c => { form[c.sufixo] = numParaTexto(dadosLocais.metas[c.sufixo]); });
    setFormMetas(form);
    setMetasModalAberto(true);
  }

  function salvarMetas() {
    const metas = {};
    ALOCACAO_CLASSES.forEach(c => { metas[c.sufixo] = toFloat(formMetas[c.sufixo]); });
    setDadosLocais(prev => ({ ...prev, metas }));
    setMetasModalAberto(false);
  }

  function abrirEdicaoProventos() {
    setFormProventos(
      (dadosLocais.proventos ?? []).map(r => ({ ano: String(r.ano ?? ""), total_ano: formatarBRLInput(String(Math.round(toFloat(r.total_ano) * 100))) }))
    );
    setProventosModalAberto(true);
  }

  function salvarProventos() {
    const proventos = formProventos
      .map(r => ({ ano: String(r.ano ?? "").trim(), total_ano: parseBRLInput(r.total_ano) }))
      .filter(r => r.ano);
    setDadosLocais(prev => ({ ...prev, proventos }));
    setProventosModalAberto(false);
  }

  function abrirEdicaoEvolucao() {
    const anoAtual = String(new Date().getFullYear());
    setFormEvolucao(
      (dadosLocais.evolucao ?? [])
        .filter(r => String(r.ano ?? "") !== anoAtual)
        .map(r => ({ ano: String(r.ano ?? ""), valor: formatarBRLInput(String(Math.round(toFloat(r.valor) * 100))) }))
    );
    setEvolucaoModalAberto(true);
  }

  function salvarEvolucao() {
    const anoAtual = String(new Date().getFullYear());
    const evolucao = formEvolucao
      .map(r => ({ ano: String(r.ano ?? "").trim(), valor: parseBRLInput(r.valor) }))
      .filter(r => r.ano && r.ano !== anoAtual)
      .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));

    setDadosLocais(prev => ({ ...prev, evolucao }));
    setEvolucaoModalAberto(false);
  }

  if (loading) return (
    <>
      <Style />
      <Loading tema={tema} />
    </>
  );

  if (erro) return (
    <>
      <Style />
      <div className="loading-page">
        <div className="loading-box card">
          <div style={{ color: COR_BAIXA, fontSize: 18, textAlign: "center" }}>
            Erro ao Carregar Dados:<br /><small>{erro}</small>
          </div>
        </div>
      </div>
    </>
  );

  const ativos    = montarAtivos(dadosPlanilha.ativos, dadosLocais);
  const taxaDolar = calcularTaxaDolar(dadosPlanilha.ativos);
  const totais    = calcularTotais(ativos, dadosLocais.reserva_atual, taxaDolar);
  const alocacao  = calcularAlocacao(totais, dadosLocais.reserva_atual, dadosLocais.metas);
  const reservas  = [{ reserva_atual: dadosLocais.reserva_atual }];

  const ativoAtual = ativos.find(a => a.ticker === ativoEditando) ?? null;
  const novoAtivoAberto = ativoEditando === NOVO_ATIVO_MARCADOR;
  const modalAtivoAberto = novoAtivoAberto || !!ativoAtual;

  return (
    <>
      <Style />
      <div className="root" ref={scrollRef} onScroll={handleScroll}>
        <Navbar
          scrolled={scrolled}
          ativos={ativos}
          onSelectTicker={(ticker) => {
            if (pagina !== "investimentos" && pagina !== "cotacoes") irParaPagina("investimentos");
            setSearchCmd({ ticker, v: Date.now() });
          }}
          pagina={pagina}
          onNavigate={irParaPagina}
          onNovoLancamento={() => financasRef.current?.abrirNovoLancamento()}
          tema={tema}
          onAlternarTema={alternarTema}
        />
        <BotaoTopoFlutuante scrolled={scrolled} onTop={scrollToTop} />
        <main className="main">

          {pagina === "patrimonio" && (
            <>
              <div id="sec-patrimonio"><CardPatrimonio totais={totais} evolucao={dadosLocais.evolucao} onEditarEvolucao={abrirEdicaoEvolucao} /></div>
              <div id="sec-classes-patrimonio"><CardClassesAtivos totais={totais} reservas={reservas} /></div>
            </>
          )}

          {pagina === "investimentos" && (
            <>
              <div id="sec-resumo-investimentos"><CardResumoInvestimentos totais={totais} /></div>
              <div id="sec-reserva"><CardReserva reservas={reservas} alocacao={alocacao} totais={totais} onEditar={abrirEdicaoReserva} /></div>
              <div id="sec-alocacao"><CardAlocacao alocacao={alocacao} onEditar={abrirEdicaoMetas} /></div>
              <div id="sec-brasil-exterior"><CardBrasilExterior alocacao={alocacao} totais={totais} /></div>
              <div id="sec-aporte"><CardAporte ativos={ativos} alocacao={alocacao} /></div>
              <div id="sec-proventos"><CardProventos proventos={dadosLocais.proventos} onEditar={abrirEdicaoProventos} /></div>
              <div id="sec-heatmap">
                <CardHeatmap
                  ativos={ativos}
                  onSelectTicker={(ticker) => {
                    if (pagina !== "investimentos") irParaPagina("investimentos");
                    setSearchCmd({ ticker, v: Date.now() });
                  }}
                />
              </div>
              {CLASSES_ATIVOS.map(c => (
                <div id={`sec-${c.sufixo}`} key={c.classe}>
                  <CardClasse
                    titulo={c.titulo}
                    sufixo={c.sufixo}
                    classe={c.classe}
                    totais={totais}
                    ativos={ativos}
                    selectedTicker={searchCmd?.ticker}
                    searchVersion={searchCmd?.v}
                    scrollRef={scrollRef}
                    onEditarAtivo={abrirEdicaoAtivo}
                    onAdicionarAtivo={abrirNovoAtivo}
                  />
                </div>
              ))}
            </>
          )}

          {pagina === "cotacoes" && (
            <>
              <div id="sec-resumo-cotacoes">
                <CardResumoCotacoes ativos={ativos.filter(a => CLASSES_ATIVOS.some(c => c.classe === a.classe))} />
              </div>
              {CLASSES_ATIVOS.map(c => (
                <div id={`sec-cotacao-${c.sufixo}`} key={c.classe}>
                  <CardCotacoesClasse
                    titulo={c.titulo}
                    sufixo={c.sufixo}
                    classe={c.classe}
                    ativos={ativos}
                    selectedTicker={searchCmd?.ticker}
                    searchVersion={searchCmd?.v}
                    scrollRef={scrollRef}
                  />
                </div>
              ))}
            </>
          )}

          {pagina === "financas" && (
            <PaginaFinancas
              ref={financasRef}
              lancamentos={lancamentos}
              setLancamentos={setLancamentos}
              metaDespesa={metaDespesa}
              setMetaDespesa={setMetaDespesa}
            />
          )}

          <footer className="app-footer">
            <span className="app-footer-linha">Meu programa de acompanhamento de patrimônio, investimentos e finanças</span>
            <span className="app-footer-linha">Por Jakson Franceschini</span>
          </footer>
        </main>
      </div>

      {modalAtivoAberto && (
        <ModalAtivo
          ticker={novoAtivoAberto ? "" : ativoAtual.ticker}
          isNovo={novoAtivoAberto}
          form={formAtivo}
          onChange={setFormAtivo}
          onSalvar={salvarAtivo}
          onLimpar={limparAtivo}
          temDados={!novoAtivoAberto && Object.keys(dadosLocais.ativos ?? {}).some(k => k.toLowerCase() === String(ativoEditando).toLowerCase())}
          onFechar={() => setAtivoEditando(null)}
        />
      )}

      {reservaModalAberto && (
        <ModalReserva
          valor={formReserva}
          onChangeValor={v => setFormReserva(formatarBRLInput(v))}
          onSalvar={salvarReserva}
          onFechar={() => setReservaModalAberto(false)}
        />
      )}

      {metasModalAberto && (
        <ModalMetasAlocacao
          form={formMetas}
          onChange={setFormMetas}
          onSalvar={salvarMetas}
          onFechar={() => setMetasModalAberto(false)}
        />
      )}

      {proventosModalAberto && (
        <ModalListaAnos
          titulo="Editar proventos"
          campos={[{ key: "total_ano", label: "Total recebido no ano (R$)" }]}
          linhas={formProventos}
          onChange={setFormProventos}
          onSalvar={salvarProventos}
          onFechar={() => setProventosModalAberto(false)}
        />
      )}

      {evolucaoModalAberto && (
        <ModalListaAnos
          titulo="Editar evolução do patrimônio"
          campos={[
            { key: "valor", label: "Patrimônio no ano (R$)" },
          ]}
          linhas={formEvolucao}
          onChange={setFormEvolucao}
          onSalvar={salvarEvolucao}
          onFechar={() => setEvolucaoModalAberto(false)}
        />
      )}
    </>
  );
}

function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');

      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      svg, svg *, .recharts-wrapper, .recharts-surface { outline: none !important; }
      svg:focus, svg *:focus { outline: none !important; }

            :root {
        --bg:             #0b0c0c;
        --bg2:            #1a1c1d;
        --bg3:            #1e2021;
        --bg4:            #292b2c;
        --border:         rgba(255, 255, 255, 0.07);
        --border2:        rgba(255, 255, 255, 0.065);
        --text:           #f3f2ee;
        --muted:          #8d908f;
        --accent:         #0a5550;
        --accent-h:       #0d6e68;
        --accent-p:       #13a097;
        --color-title:    #f3f2ee;
        --color-subtitle: #a3a5a3;
        --color-label:    #8d908f;
        --color-value:    #f3f2ee;
        --color-neutral:  #f3f2ee;
        --navbar-bg:      rgba(26, 28, 29, 0.55);
        --navbar-border:  rgba(255, 255, 255, 0.07);
        --spinner-track:  rgba(10, 85, 80, 0.2);

        --radius-card:    24px;
        --radius-subcard: calc(var(--radius-card) - 6px);

                --space-1:  4px;
        --space-2:  8px;
        --space-3:  12px;
        --space-4:  16px;
        --space-5:  20px;
        --space-6:  24px;
        --space-7:  28px;
        --space-8:  32px;

                --radius-sm:   12px;
        --radius-md:   16px;
        --radius-pill: 99px;

                --bar-track:  rgba(255, 255, 255, 0.06);
        --bar-altura: 10px;
      }

      :root[data-theme="light"] {
        --bg:             #f4f6f5;
        --bg2:            #ffffff;
        --bg3:            #eef1f0;
        --bg4:            #e2e7e5;
        --border:         rgba(9, 30, 27, 0.09);
        --border2:        rgba(9, 30, 27, 0.08);
        --text:           #10201d;
        --muted:          #5c6663;
        --accent:         #0a5550;
        --accent-h:       #0d6e68;
        --accent-p:       #0e7971;
        --color-title:    #0d1a18;
        --color-subtitle: #4d5754;
        --color-label:    #626c69;
        --color-value:    #0d1a18;
        --color-neutral:  #0d1a18;
        --navbar-bg:      rgba(255, 255, 255, 0.68);
        --navbar-border:  rgba(9, 30, 27, 0.08);
        --spinner-track:  rgba(10, 85, 80, 0.15);
        --bar-track:      rgba(9, 30, 27, 0.07);
      }

      html, body, #root {
        height: 100%;
        background-color: var(--bg);
        background-image:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.045 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
          radial-gradient(ellipse 900px 520px at 50% -12%, rgba(255,255,255,0.05), transparent 60%),
          radial-gradient(ellipse 700px 460px at 105% 18%, rgba(255,255,255,0.03), transparent 55%),
          radial-gradient(ellipse 800px 500px at -10% 90%, rgba(255,255,255,0.02), transparent 55%),
          linear-gradient(180deg, #131415 0%, #0e0f10 45%, #0b0c0c 100%);
        background-repeat: repeat, no-repeat, no-repeat, no-repeat, no-repeat;
        background-attachment: scroll, scroll, scroll, scroll, fixed;
        color: var(--text);
        font-family: "Manrope", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        transition: background-color 0.25s ease, color 0.25s ease;
      }

      :root[data-theme="light"] html,
      :root[data-theme="light"] body,
      :root[data-theme="light"] #root {
        background-image:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
          radial-gradient(ellipse 900px 520px at 50% -12%, rgba(10,85,80,0.06), transparent 60%),
          radial-gradient(ellipse 700px 460px at 105% 18%, rgba(10,85,80,0.04), transparent 55%),
          radial-gradient(ellipse 800px 500px at -10% 90%, rgba(10,85,80,0.03), transparent 55%),
          linear-gradient(180deg, #fbfcfb 0%, #f6f8f7 45%, #f4f6f5 100%);
      }

            .root {
        height: 100vh;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        scrollbar-gutter: stable both-edges;
      }

      * {
        -webkit-tap-highlight-color: transparent;
        font-family: "Manrope", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif !important;
      }

            .navbar {
        position: fixed;
        top: 6px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        width: calc(100% - 40px);
        max-width: 1160px;
        box-sizing: border-box;
        border-radius: 26px;
        padding: var(--space-5) var(--space-6);
        display: flex;
        flex-direction: column;
        background: var(--navbar-bg);
        border: 1px solid var(--navbar-border);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
        transition: all 0.5s ease;
      }
      .navbar-inner {
        display: grid;
        grid-template-columns: 1fr minmax(0, auto) 1fr;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
      }
      .navbar-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; cursor: default; }
      .navbar-left img,
      .navbar-left .navbar-logo {
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .navbar-left:hover img,
      .navbar-left:hover .navbar-logo {
        transform: scale(1.08);
      }

      .navbar-right { display: flex; align-items: center; gap: var(--space-2); justify-self: end; min-width: 0; position: relative; }

            .btn-tema {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 50%;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      }
      .btn-tema:hover {
        background: var(--bg4);
        box-shadow: 0 4px 16px rgba(10,85,80,0.25);
      }
      .btn-tema:active { transform: scale(0.96); }
      .btn-tema-subcard { background: var(--bg3); }
      .btn-tema-linha { width: 32px; height: 32px; font-size: 14px; margin-left: var(--space-2); }

            .navbar-search-inline {
        width: 240px;
        min-width: 240px;
        max-width: 240px;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 999px;
        padding: 10px var(--space-3);
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .navbar-search-inline:focus-within {
        border-color: #0a5550;
        box-shadow: 0 0 0 2px rgba(10,85,80,0.15);
      }
      .navbar-search-icon { display: flex; align-items: center; opacity: 0.5; flex-shrink: 0; color: var(--color-value); }
      .navbar-search-inline-input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--color-value);
        font-size: 13px;
        font-family: inherit;
        width: 160px;
        transition: width 0.2s ease;
      }
      .navbar-search-inline-input:focus { width: 200px; }
      .navbar-search-inline-input::placeholder { color: var(--color-label); }

            .navbar-search-box {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;

        width: min(320px, calc(100vw - 24px));
        max-width: calc(100vw - 24px);

        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        z-index: 200;
      }
      .navbar-search-box-desktop {
        left: 0;
        right: auto;
        width: 240px;
        min-width: 240px;
        max-width: 240px;
      }
      .navbar-search-input {
        width: 100%;
        background: transparent;
        border: none;
        color: var(--color-value);
        font-size: 14px;
        padding: var(--space-3) var(--space-4);
        outline: none;
        font-family: inherit;
      }
      .navbar-search-input::placeholder { color: var(--color-label); }
      .navbar-search-box-desktop {
        right: auto;
        left: 0;
        width: 100%;
        min-width: 240px;
      }
      .navbar-search-results {
        display: flex;
        flex-direction: column;
        max-height: 240px;
        overflow-y: auto;
        border-top: none !important;
      }
      .navbar-search-results::before,
      .navbar-search-results::after {
        display: none !important;
      }
      .navbar-search-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
        text-align: left;
      }
      .navbar-search-item:hover { background: var(--bg3); }
      .btn-tema svg,
      .navbar-search-icon {
        color: var(--color-value);
      }

      .navbar-logo {
        width: 36px; height: 36px;
        background: var(--accent);
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 18px; color: #f5f5f7; flex-shrink: 0;
      }
      .navbar-logo-img {
        height: 38px; width: auto; max-width: 130px;
        object-fit: contain; flex-shrink: 0;
      }

            .navbar-nav { display: flex; align-items: center; min-width: 0; }
      .navbar-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-pill);
        padding: 4px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .navbar-tabs::-webkit-scrollbar { display: none; }
      .navbar-tab {
        background: transparent;
        border: none;
        color: var(--color-label);
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        white-space: nowrap;
        cursor: pointer;
        padding: 9px 18px;
        border-radius: var(--radius-pill);
        transition: color 0.2s ease, background 0.2s ease;
      }
      .navbar-tab:hover { color: var(--color-value); background: rgba(255, 255, 255, 0.06); }
      :root[data-theme="light"] .navbar-tab:hover { background: rgba(9, 30, 27, 0.05); }
      .navbar-tab-ativo {
        background: var(--accent);
        color: #f5f5f7;
      }
      .navbar-tab-ativo:hover { color: #f5f5f7; }

            .navbar-hamburger-wrap { display: none; }

            .navbar-menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 500;
        background: rgba(9, 10, 10, 0.7);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        display: flex;
        flex-direction: column;
        padding: var(--space-5) var(--space-5) var(--space-6);
        box-sizing: border-box;
        overflow-y: auto;
        animation: navbarMenuFade 0.2s ease;
      }
      :root[data-theme="light"] .navbar-menu-overlay { background: rgba(244, 246, 245, 0.82); }
      @keyframes navbarMenuFade {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      .navbar-menu-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        flex-shrink: 0;
      }
      .navbar-menu-overlay-list {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--space-3);
        flex: 1;
        margin-top: 0;
        margin-bottom: 45px;
      }
      .navbar-menu-overlay-item {
        background: rgba(255, 255, 255, 0.045);
        border: 1px solid var(--border2);
        color: var(--color-label);
        font-family: inherit;
        font-size: 19px;
        font-weight: 600;
        text-align: center;
        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .navbar-menu-overlay-item:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--color-value);
      }
      :root[data-theme="light"] .navbar-menu-overlay-item { background: rgba(9, 30, 27, 0.035); }
      :root[data-theme="light"] .navbar-menu-overlay-item:hover { background: rgba(9, 30, 27, 0.06); }
      .navbar-menu-overlay-item.is-ativo {
        background: var(--accent);
        border-color: transparent;
        color: #f5f5f7;
      }

      @media (max-width: 1024px) {
        .navbar-tab { padding: 8px 14px; font-size: 13px; }
      }
      @media (max-width: 640px) {
        .navbar-tabs { display: none; }
        .navbar-hamburger-wrap { display: block; }
      }

            .btn-topo-flutuante {
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #0a5550;
        color: #f5f5f7;
        border: 1px solid rgba(5, 120, 112, 0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        z-index: 99;
      }
      .btn-topo-flutuante-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .btn-topo-flutuante:hover {
        background: #0d6e68;
        box-shadow: 0 6px 24px rgba(20, 168, 159, 0.55), inset 0 1px 0 rgba(255,255,255,0.2);
        transform: translateY(-2px);
      }
      .btn-topo-flutuante:active {
        transform: scale(0.96);
        box-shadow: 0 2px 8px rgba(20, 168, 159, 0.3);
      }

            .main {
        max-width: 1200px;
        margin: 0 auto;
        padding: 120px var(--space-5) 20px;
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
      }

            .app-footer {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        text-align: center;
        padding: var(--space-4) 0 0;
        color: var(--color-label);
      }
      .app-footer-linha { font-size: 13px; }
      .app-footer-linha:first-child { opacity: 0.8; }
      .app-footer-linha:last-child { opacity: 0.55; font-size: 12px; }

            .card {
        background: var(--bg2);
        border-radius: var(--radius-card);
        border: 1px solid var(--border);
        padding: var(--space-5) !important;
        display: flex;
        flex-direction: column;
        gap: var(--space-4) !important;
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.32);
        backface-visibility: hidden;
        perspective: 1000px;
        transform: translate3d(0,0,0);
        will-change: transform;
        transition: background 0.3s ease, border-color 0.3s ease;
      }
      .card-titulo {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.015em;
        color: var(--color-title);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .card-titulo-icone {
        flex-shrink: 0;
        color: var(--accent, currentColor);
        opacity: 0.9;
        margin-left: -3px;
      }
      .card-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }

            .subcard {
        background: var(--bg3);
        border-radius: var(--radius-subcard);
        border: 1px solid var(--border2);
        padding: var(--space-5) !important;
        display: flex;
        flex-direction: column;
        gap: var(--space-1) !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.3s ease;
        position: relative;
        overflow: hidden;
      }
      .subcard-titulo {
        padding: var(--space-2) var(--space-4) !important;
        border-radius: var(--radius-subcard) !important;
      }

            .campo { display: flex; flex-direction: column; gap: var(--space-1); }
      .campo-titulo {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-label);
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
      }
      .campo-valor {
        font-size: 31px;
        font-weight: 800;
        letter-spacing: -0.025em;
        line-height: 1.05;
        color: var(--color-value);
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        font-variant-numeric: tabular-nums;
      }

            .divisor { margin-top: 15px; height: 0; border-top: 1px solid var(--border2); }

            .hero-valor { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
      .hero-valor-titulo { font-size: 14px; letter-spacing: 0.05em; }
      .hero-valor-valor { line-height: 1; }

            .barra-track {
        position: relative;
        height: var(--bar-altura);
        border-radius: var(--radius-pill);
        overflow: hidden;
        background: var(--bar-track);
      }
      .barra-fill {
        position: absolute;
        top: 0;
        height: 100%;
        transition: width 1.1s cubic-bezier(0.4,0,0.2,1);
      }
      .barra-fill.full  { left: 0; width: 100%; border-radius: var(--radius-pill); }
      .barra-fill.left  { left: 0;  border-radius: var(--radius-pill) 0 0 var(--radius-pill); transition-delay: 0.1s; }
      .barra-fill.right { right: 0; border-radius: 0 var(--radius-pill) var(--radius-pill) 0; }

            .dropdown-wrap { position: relative; }
      .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text);
      }
      .dropdown-trigger-sub { font-size: 14px; opacity: 0.8; color: var(--text); }
      .dropdown-menu {
        position: absolute;
        top: calc(100% + var(--space-2));
        left: 0;
        z-index: 50;
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        min-width: 130px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      }
      .dropdown-item {
        background: transparent;
        color: var(--text);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        padding: var(--space-3) var(--space-3);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        text-align: left;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        font-family: inherit;
      }
      .dropdown-item:hover { background: var(--bg4); }
      .dropdown-item:focus-visible {
        outline: 2px solid var(--accent-p);
        outline-offset: 1px;
      }
      .dropdown-item.is-ativo {
        background: var(--accent);
        color: #f5f5f7;
        border-color: rgba(5, 120, 112, 0.4);
        font-weight: 600;
      }

            .dropdown-menu-flutuante {
        position: fixed !important;
        z-index: 9999;
      }

            .ativo-nome-ticker {
        font-size: 20px;
        font-weight: 500;
        color: var(--color-value);
        letter-spacing: 0.05em;
        line-height: 1.1;
      }
      .ativo-nome-texto {
        font-size: 13px;
        color: var(--color-label);
        margin-top: var(--space-1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @media (max-width: 640px) {
        .ativo-nome-ticker { font-size: 17px; }
        .ativo-nome-texto  { font-size: 12px; }
      }

      .list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        --row-pad-x: var(--space-5);
        padding: var(--space-4) var(--row-pad-x);
        position: relative;
        transition: background 0.15s ease;
      }
      .list-row:not(:last-child)::after {
        content: "";
        position: absolute;
        left: var(--row-pad-x);
        right: var(--row-pad-x);
        bottom: 0;
        height: 0;
        border-bottom: 1px solid var(--border2);
        transition: opacity 0.15s ease;
      }
      .list-row-clickable {
        cursor: pointer;
        margin: 0 -10px;
        /* 9px + 1px de borda transparente = 10px, compensa exatamente a margem negativa */
        padding-left: calc(var(--row-pad-x) + 9px);
        padding-right: calc(var(--row-pad-x) + 9px);
        border-radius: var(--radius-subcard);
        border: 1px solid transparent;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
      }
      /* divisória alinhada ao conteúdo (mesmo padding dos outros cards), sem vazar pela margem negativa do hover */
      .list-row-clickable:not(:last-child)::after {
        left: calc(var(--row-pad-x) + 9px);
        right: calc(var(--row-pad-x) + 9px);
      }
      .list-row-clickable:hover {
        background: rgba(255,255,255,0.05);
        border-color: rgba(255,255,255,0.09);
        transform: scale(1.015);
      }
      :root[data-theme="light"] .list-row-clickable:hover {
        background: rgba(9, 30, 27, 0.035);
        border-color: rgba(9, 30, 27, 0.08);
      }
      .list-row-clickable:hover::after { opacity: 0; }
      .list-row-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
      .list-row-label {
        font-size: 15px;
        font-weight: 500;
        color: var(--color-value);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .list-row-tag {
        font-size: 10px;
        font-weight: 500;
        color: var(--color-label);
        letter-spacing: 0.03em;
      }
      .card-titulo-contador {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-label);
        background: var(--bg4);
        border-radius: var(--radius-pill);
        padding: 1px 9px;
        margin-left: var(--space-2);
      }
      .list-row-right { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
      .list-row-values { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); }
      .list-row-value {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-value);
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .list-row-sub {
        font-size: 11px;
        font-weight: 500;
        color: var(--color-label);
        text-align: right;
        white-space: nowrap;
      }
      .list-row-plain {
        --row-pad-x: 0px;
      }
            .list-row-filtrado {
        margin: 0 -10px;
        padding-left: 10px;
        padding-right: 10px;
        border-radius: var(--radius-subcard);
        background: var(--hl-bg, rgba(19, 160, 151, 0.08));
        box-shadow: inset 0 0 0 1px var(--hl-border, rgba(19, 160, 151, 0.5));
      }
      .list-row-filtrado::after {
        display: none !important;
      }
      .ativo-cabecalho-filtrado {
        position: relative;
        margin: -10px;
        padding: 10px;
        border-radius: var(--radius-subcard);
        background: rgba(19, 160, 151, 0.08);
        box-shadow: inset 0 0 0 1px rgba(19, 160, 151, 0.5);
      }
      .list-row-chevron {
        color: var(--color-label);
        opacity: 0.55;
        flex-shrink: 0;
      }
      @media (max-width: 640px) {
                .list-row { gap: var(--space-2); --row-pad-x: var(--space-4); }
        .list-row-plain { --row-pad-x: 0px; }
        .list-row-label { font-size: 13px; }
        .list-row-value { font-size: 13px; }
        .list-row-sub { font-size: 10px; }
      }

      .btn-filtro-simples {
        background: var(--bg3);
        color: var(--color-value);
        border: 1px solid var(--border2);
        padding: var(--space-3);
        font-size: 14px;
        cursor: pointer;
        font-weight: 600;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        position: relative;
        border-radius: 999px;
        transition: color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
        gap: var(--space-2);
        min-width: 38px;
        min-height: 38px;
        width: auto;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        -webkit-tap-highlight-color: transparent;
      }
      .btn-texto {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .click-glow {
        animation: glowPulseTexto 0.55s ease-out;
      }
      @keyframes glowPulseTexto {
        0% {
          text-shadow: 0 0 0 rgba(10, 85, 80, 0);
          filter: brightness(1);
        }
        40% {
          text-shadow: 0 0 10px rgba(10, 85, 80, 0.85);
          filter: brightness(1.3);
        }
        100% {
          text-shadow: 0 0 0 rgba(10, 85, 80, 0);
          filter: brightness(1);
        }
      }
      .btn-ver-icon {
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        transform: rotate(0deg);
      }
      .btn-ver-icon.is-open {
        transform: rotate(180deg);
      }

      .btn-filtro-simples:hover {
        background: var(--bg4);
        box-shadow: 0 4px 16px rgba(10,85,80,0.25);
      }
      .btn-filtro-simples:active {
        transform: scale(0.96);
      }
      .btn-filtro-simples-ativo {
        color: #0a5550;
        border-color: #0a5550;
        background: rgba(10, 85, 80, 0.15);
      }

      @media (max-width: 640px) {
        .navbar-search-box {
          position: fixed !important;
          top: 90px;
          left: 50%;
          transform: translateX(-50%);
          width: calc(100vw - 24px);
          max-width: none;
          margin: 0;
          box-sizing: border-box;
          z-index: 9999;
          border-color: #0a5550;
        }
        .navbar-search-input {
          width: 100%;
          box-sizing: border-box;
        }
        
      }
      .filtros-row {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
        padding-top: var(--space-1);
      }
      .filtros-row .btn-filtro-simples {
        padding-left: 18px;
        padding-right: 18px;
      }
      .filtro-botao-mobile { display: none; }
      .filtro-botao-desktop { display: flex; }
      @media (max-width: 640px) {
        .filtro-botao-mobile { display: block; }
        .filtro-botao-desktop { display: none; }
      }

            .ativos-lista { display: flex; flex-direction: column; gap: var(--space-4); }

            .heatmap-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: var(--space-3);
      }
      @media (max-width: 1024px) { .heatmap-grid { grid-template-columns: repeat(4, 1fr); } }
      @media (max-width: 640px)  { .heatmap-grid { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 380px)  { .heatmap-grid { grid-template-columns: repeat(2, 1fr); } }

      .heatmap-cell {
        border-radius: 24px;
        padding: var(--space-3) var(--space-2);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        cursor: pointer;
        transition: filter 0.2s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
        min-height: 90px;
      }
      .heatmap-cell:hover { filter: brightness(1.15); transform: scale(1.03); }
      .hm-ticker { color: #f5f5f7; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
      .hm-pct    { color: #f5f5f7; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .hm-brl    { color: rgba(255,255,255,0.8); font-size: 14px; font-variant-numeric: tabular-nums; }

      @media (min-width: 1024px) {
        .hm-pct {font-size: 14px !important;}
        .hm-brl {font-size: 16px !important;}
      }

            .barra-proventos { border-radius: 10px 10px 4px 4px; }
      .barra-proventos-glow { border-radius: 10px 10px 0 0; }

      @media (min-width: 1024px) {
        .barra-proventos { border-radius: 14px 14px 5px 5px; }
        .barra-proventos-glow { border-radius: 14px 14px 0 0; }
      }

      @media (min-width: 1440px) {
        .barra-proventos { border-radius: 18px 18px 6px 6px; }
        .barra-proventos-glow { border-radius: 18px 18px 0 0; }
      }

            .chart-tooltip {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13px;
      }
      .tooltip-label { color: var(--muted); margin-bottom: var(--space-1); }
      .tooltip-val   { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .tooltip-sub   { font-size: 13px; margin-top: 2px; }

            .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: modalFadeIn 0.2s ease;
        padding: var(--space-4);
      }
      @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .modal-sheet {
        width: 100%;
        max-width: 420px;
        max-height: 80vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        -ms-overflow-style: none;
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: var(--radius-card);
        padding: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        box-shadow: 0 -10px 40px rgba(0,0,0,0.4);
        animation: modalSlideUp 0.28s cubic-bezier(0.22,1,0.36,1);
      }
      .modal-sheet::-webkit-scrollbar { display: none; width: 0; height: 0; }
      @media (max-width: 480px) {
        .modal-sheet { padding: var(--space-4); }
      }
      @keyframes modalSlideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .modal-header { display: flex; align-items: center; justify-content: space-between; }
      .modal-titulo { font-size: 18px; font-weight: 600; color: var(--color-title); }
      .modal-fechar {
        background: var(--bg4);
        border: 1px solid var(--border2);
        color: var(--color-label);
        width: 30px; height: 30px;
        border-radius: 50%;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px;
      }
      .modal-fechar:hover { color: var(--color-value); background: var(--bg3); }

      .tipo-toggle { display: flex; gap: var(--space-2); }
      .tipo-opcao {
        flex: 1;
        background: var(--bg3);
        border: 1px solid var(--border2);
        color: var(--color-label);
        font-weight: 600;
        font-size: 14px;
        font-family: inherit;
        padding: var(--space-3);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .tipo-opcao-ativa.income { background: rgba(10,85,80,0.2); border-color: #0a5550; color: #f5f5f7; }
      .tipo-opcao-ativa.expense { background: rgba(138,53,53,0.2); border-color: #8a3535; color: #f5f5f7; }

      .modal-sheet.tipo-despesa .form-input:focus,
      .modal-sheet.tipo-despesa .form-select:focus {
        border-color: #8a3535;
        box-shadow: 0 0 0 2px rgba(138,53,53,0.15);
      }
      .modal-sheet.tipo-despesa .form-select-aberto {
        border-color: #8a3535;
        box-shadow: 0 0 0 2px rgba(138,53,53,0.15);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%238a3535' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      }
      .modal-sheet.tipo-despesa .form-botao:not(.form-botao-perigo):not(.form-botao-secundario) {
        background: #8a3535;
      }
      .modal-sheet.tipo-despesa .form-botao:not(.form-botao-perigo):not(.form-botao-secundario):hover {
        background: #9c3d3d;
      }

      .form-grupo { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
      .input-meta-alocacao { width: 84px; text-align: center; }
      .form-input {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-3) var(--space-4);
        font-size: 15px;
        color: var(--color-value);
        font-family: inherit;
        outline: none;
        width: 100%;
        min-width: 0;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .form-input:focus { border-color: #0a5550; box-shadow: 0 0 0 2px rgba(10,85,80,0.15); }
      .form-input::placeholder { color: var(--color-label); }

      .form-select {
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        cursor: pointer;
        padding-right: 40px;
        display: flex;
        align-items: center;
        text-align: left;
        font-size: 15px;
        font-family: inherit;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%238e8e93' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--space-4) center;
        background-size: 16px;
        transition: border-color 0.15s, box-shadow 0.15s, background-image 0.15s;
      }
      .form-select-aberto,
      .form-select:focus {
        border-color: #0a5550;
        box-shadow: 0 0 0 2px rgba(10,85,80,0.15);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%230d6e68' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      }
      .form-select-aberto { background-position: right var(--space-4) center; transform: none; }
      .form-select option {
        background: var(--bg3);
        color: var(--color-value);
      }

            .dropdown-menu-select {
        padding: var(--space-2);
        max-height: 260px;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .dropdown-menu-select::-webkit-scrollbar { display: none; width: 0; height: 0; }
      .dropdown-menu-select { min-width: 0; box-sizing: border-box; }
      .dropdown-menu-anos .dropdown-item { text-align: center; justify-content: center; }
      .dropdown-menu-select .dropdown-item {
        font-size: 15px;
        padding: var(--space-3) var(--space-3);
      }

      .form-botao {
        background: var(--accent);
        color: #f5f5f7;
        border: none;
        border-radius: var(--radius-md);
        padding: var(--space-4);
        font-size: 15px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.15s ease;
      }
      .form-botao:hover { background: var(--accent-h); }
      .form-botao:active { transform: scale(0.98); }
      .form-botao-perigo { background: transparent; border: 1px solid rgba(138,53,53,0.4); color: #c0504a; }
      .form-botao-perigo:hover { background: rgba(138,53,53,0.12); }
      .form-botao-secundario { background: transparent; border: 1px solid var(--border2); color: var(--color-label); }
      .form-botao-secundario:hover { background: var(--bg3); color: var(--color-value); }

            .lista-anos-wrap {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .lista-anos-linha {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-4);
        transition: border-color 0.15s ease;
      }
      .lista-anos-linha:focus-within {
        border-color: rgba(10,85,80,0.5);
      }
      .lista-anos-linha-header {
        display: flex;
        align-items: flex-end;
        gap: var(--space-3);
      }
      .lista-anos-ano {
        flex: 0 0 auto;
        min-width: 0;
        max-width: 100px;
      }
      .lista-anos-valor {
        flex: 1;
        min-width: 0;
      }
      .alocacao-item {
        position: relative;
        padding-bottom: var(--space-3);
      }
      .alocacao-item:not(:last-child) {
        margin-bottom: var(--space-1);
      }
      .alocacao-item .list-row::after { display: none; }
      .alocacao-item .list-row { padding-bottom: var(--space-1); }
      .alocacao-mini-barra {
        display: block;
        width: 100%;
        height: 6px;
        border-radius: var(--radius-pill);
        background: var(--bg4);
        overflow: hidden;
      }
      .alocacao-mini-barra-fill {
        display: block;
        height: 100%;
        border-radius: var(--radius-pill);
        transition: width 0.45s ease;
      }
      .btn-remover-linha {
        background: rgba(138,53,53,0.12);
        border: 1px solid rgba(138,53,53,0.3);
        color: #c0504a;
        width: 42px;
        height: 42px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        margin-left: auto;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .btn-remover-linha:hover { background: rgba(138,53,53,0.22); border-color: rgba(138,53,53,0.5); }
      .btn-remover-linha:active { transform: scale(0.92); }
      .lista-anos-vazio {
        color: var(--color-label);
        font-size: 14px;
        text-align: center;
        padding: var(--space-4) 0;
      }

            .loading-page {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg);
      }
      .loading-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 36px;
        width: 300px;
      }
      .loading-box.card {
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 24px;
        padding: var(--space-8);
      }
      .loading-logo {
        width: 72px; height: 72px;
        background: var(--accent);
        border-radius: 20px;
        display: flex; align-items: center; justify-content: center;
        font-size: 38px; font-weight: 900; color: #f5f5f7;
      }
      .loading-logo-img {
        height: 82px; width: auto; max-width: 224px;
        object-fit: contain;
      }
      .loading-logo-breathe {
        animation: logoBreathe 2.6s ease-in-out infinite;
      }
      @keyframes logoBreathe {
        0%, 100% { transform: scale(1);    filter: brightness(1)    drop-shadow(0 0 0px rgba(10,85,80,0)); }
        50%      { transform: scale(1.07); filter: brightness(1.08) drop-shadow(0 0 16px rgba(10,85,80,0.5)); }
      }
      .loading-texto { font-size: 16px; color: var(--color-subtitle); }

            .spinner-wrap { display: flex; justify-content: center; }
      .spinner {
        width: 34px; height: 34px;
        border: 3px solid var(--spinner-track);
        border-top-color: #0a5550;
        border-radius: 50%;
        animation: spin 0.8s linear infinite, spinnerGlow 1.6s ease-in-out infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes spinnerGlow {
        0%, 100% { box-shadow: 0 0 0px rgba(10,85,80,0); }
        50%       { box-shadow: 0 0 18px 6px rgba(10,85,80,0.55); }
      }

            .root::-webkit-scrollbar { width: 6px; }
      .root::-webkit-scrollbar-track { background: transparent; }
      .root::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

            @media (max-width: 1024px) {
        .main { padding: 106px 18px 52px; gap: 22px; }
        .navbar { width: calc(100% - 36px); max-width: none; }
        .card { padding: var(--space-5) !important; gap: 14px; }
        .subcard { padding: 18px !important; gap: var(--space-3); }
        .list-row { --row-pad-x: 18px; }
        .list-row-plain { --row-pad-x: 0px; }
        .card-titulo { font-size: 18px; }
        .campo-valor { font-size: 28px; }
        .campo-titulo { font-size: 13px; }
      }

            @media (max-width: 640px) {
        .main { padding: 96px var(--space-3) 40px; gap: var(--space-4); }

                .navbar {
          transform: translateX(-50%);
          width: calc(100% - 24px);
          padding: 18px 14px;
          box-sizing: border-box;
          border-radius: 20px;
        }
        
        .navbar-logo-img { height: 30px; max-width: 100px; }
        .loading-logo-img { height: 66px; }

                .btn-topo-flutuante { bottom: 18px; right: 14px; width: 50px; height: 50px; }

                .card        { padding: 16px !important; gap: var(--space-3); }
        .card-titulo { font-size: 16px; }
        .card-header { gap: var(--space-2); }

                .subcard { padding: var(--space-4) !important; gap: 10px; }
        .subcard-titulo { padding: var(--space-2) var(--space-3) !important; }

                .campo       { gap: var(--space-1); }
        .campo-valor { font-size: 22px; }
        .campo-titulo { font-size: 12px; }

        .btn-filtro-simples { font-size: 13px; }
        .filtros-row { gap: var(--space-3); }

                .logo-ativo-principal { width: 52px !important; height: 52px !important; }
        .chart-tooltip { padding: var(--space-2) 10px; font-size: 11px; }
        .tooltip-val   { font-size: 13px; }
        .tooltip-sub   { font-size: 11px; }

                .heatmap-cell { min-height: 66px; padding: var(--space-2) var(--space-1); border-radius: var(--radius-md); }
        .hm-ticker { font-size: 12px; }
        .hm-pct    { font-size: 11px; }
        .hm-brl    { font-size: 14px; }
      }

            @media (max-width: 400px) {
        .main { padding: 105px 10px 34px; gap: var(--space-4); }
        .card        { padding: 13px !important; gap: var(--space-4); }
        .subcard     { padding: 12px !important; gap: var(--space-2); }
        .list-row    { --row-pad-x: 14px; }
        .list-row-plain { --row-pad-x: 0px; }
        .subcard-titulo { padding: var(--space-1) var(--space-3) !important; }
        .campo-valor  { font-size: 19px; }
        .campo-titulo { font-size: 11px; }
        .campo        { gap: var(--space-1); }
        .card-titulo  { font-size: 15px; }
        
        .btn-filtro-simples { font-size: 12px; }
        .heatmap-cell { min-height: 58px; padding: 6px 3px; }
        .logo-ativo-principal { width: 46px !important; height: 46px !important; }
        .chart-tooltip { padding: 6px var(--space-2); font-size: 10px; }
        .tooltip-val   { font-size: 12px; }
        .tooltip-sub   { font-size: 10px; }
      }

            @media (max-width: 340px) {
        .main    { padding: 78px var(--space-2) var(--space-7); gap: 10px; }
        .card    { padding: 11px !important; gap: var(--space-2); }
        .subcard { padding: 8px !important; gap: 6px; }
        .list-row { --row-pad-x: var(--space-3); }
        .list-row-plain { --row-pad-x: 0px; }
        .subcard-titulo { padding: var(--space-1) var(--space-2) !important; }
        .campo-valor  { font-size: 17px; }
        .card-titulo  { font-size: 14px; }
      }
    `}</style>
  );
}