import {
  FolderKanban,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  Settings,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BrandMark } from "../components/BrandMark";
import { useAuth } from "../context/AuthContext";
import styles from "../styles/shell.module.css";

const navItems = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard, exact: true },
  { to: "/projects", label: "Projetos", icon: FolderKanban },
  { to: "/audits/new", label: "Nova auditoria", icon: PlusCircle },
  { to: "/audits/history", label: "Execuções", icon: History },
  { to: "/settings", label: "Configurações", icon: Settings }
];

const routeMeta = [
  { match: /^\/$/, eyebrow: "Quality intelligence", title: "Centro de qualidade", description: "Risco, cobertura e evolução do portfólio em uma leitura executiva." },
  { match: /^\/projects/, eyebrow: "Portfólio monitorado", title: "Projetos", description: "Baselines, ambientes e configurações reutilizáveis por domínio." },
  { match: /^\/audits\/new/, eyebrow: "Escopo controlado", title: "Configurar auditoria", description: "Defina o que pode ser testado, em quais dispositivos e com quais limites." },
  { match: /^\/audits\/history/, eyebrow: "Rastreabilidade", title: "Execuções", description: "Consulte, compare e retome auditorias sem perder o contexto." },
  { match: /^\/audits\//, eyebrow: "Evidência verificável", title: "Relatório técnico", description: "Cobertura, jornadas, achados e artefatos ligados ao que foi realmente executado." },
  { match: /^\/settings/, eyebrow: "Preferências", title: "Configurações", description: "Conta, auditoria, IA, retenção, aparência e notificações." }
];

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const meta = useMemo(() => routeMeta.find((item) => item.match.test(location.pathname)) ?? routeMeta[0], [location.pathname]);

  useEffect(() => {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    document.body.dataset.drawerOpen = "true";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      delete document.body.dataset.drawerOpen;
    };
  }, [drawerOpen]);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">Pular para o conteúdo principal</a>

      <header className={styles.mobileHeader}>
        <div className={styles.mobileBrand}><BrandMark size={31} /><strong>AI Web Auditor</strong></div>
        <button className={styles.menuButton} type="button" onClick={() => setDrawerOpen(true)} aria-label="Abrir navegação" aria-expanded={drawerOpen}>
          <Menu size={21} />
        </button>
      </header>

      {drawerOpen ? <button className={styles.backdrop} type="button" aria-label="Fechar navegação" onClick={() => setDrawerOpen(false)} /> : null}

      <aside className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ""}`} aria-label="Navegação lateral">
        <div className={styles.brand}>
          <BrandMark size={40} />
          <div><strong>AI Web Auditor</strong><span>Evidence-first quality</span></div>
          <button className={styles.drawerClose} type="button" onClick={() => setDrawerOpen(false)} aria-label="Fechar navegação"><X size={20} /></button>
        </div>

        <div className={styles.workspaceLabel}><span>Workspace</span><strong>Portfolio Lab</strong></div>

        <nav className={styles.nav} aria-label="Navegação principal">
          {navItems.map(({ to, label, icon: Icon, exact }) => (
            <NavLink key={to} to={to} end={exact} className={({ isActive }) => (isActive ? styles.navItemActive : styles.navItem)}>
              <Icon size={18} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.systemState}><span className={styles.statusDot} /><div><strong>Motor operacional</strong><span>Validação determinística ativa</span></div></div>
          <div className={styles.userBox}>
            <div className={styles.userAvatar} aria-hidden="true">{user?.name?.slice(0, 1).toUpperCase()}</div>
            <div className={styles.userMeta}><strong>{user?.name}</strong><span>{user?.email}</span></div>
            <button className={styles.logoutButton} onClick={logout} type="button" aria-label="Encerrar sessão" title="Sair"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className={styles.content} id="main-content" tabIndex={-1}>
        <header className={styles.topbar}>
          <div><span className={styles.eyebrow}>{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div>
          <div className={styles.livePill} aria-label="Status da plataforma"><span /> Operação monitorada</div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
