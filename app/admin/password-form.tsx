"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/auth/daily-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        setSuccess(true);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Não deu pra salvar");
      }
    } catch {
      setError("Falha de conexão — tente de novo");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-card" onSubmit={handleSubmit}>
      <label htmlFor="daily-password">nova senha do dia</label>
      <div className="reset-left">
        <input
          id="daily-password"
          className="reset-input"
          style={{ width: 220, flex: "0 0 220px" }}
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="ex. girafa-azul-42"
          autoComplete="off"
        />
        <button type="submit" className="reset-btn" disabled={pending || password.trim().length < 4}>
          {pending ? "salvando…" : "salvar senha do dia"}
        </button>
      </div>
      {error && <p className="login-error">{error}</p>}
      {success && <p className="admin-success">Senha do dia atualizada — quem já estava logado como comum caiu na hora.</p>}
    </form>
  );
}
