import { getDailyPassword } from "@/lib/auth";
import { AdminPasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const daily = await getDailyPassword();
  const updatedAtLabel = daily
    ? new Date(daily.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;

  return (
    <div className="wrap">
      <header className="top">
        <div className="title-block">
          <h1>Painel admin</h1>
          <p>Defina a senha do dia — ela vale pro usuário comum até você trocar de novo.</p>
          <div className="status-line">
            <span className={`status-dot ${daily ? "on" : "off"}`} />
            <span>
              {daily
                ? `Senha do dia definida em ${updatedAtLabel}`
                : "Nenhuma senha do dia definida ainda — ninguém comum consegue entrar"}
            </span>
          </div>
        </div>
      </header>

      <AdminPasswordForm />
    </div>
  );
}
