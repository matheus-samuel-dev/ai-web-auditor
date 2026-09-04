const form = document.querySelector("#login-form");
const status = document.querySelector("#login-status");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Validando credenciais…";
  const body = Object.fromEntries(new FormData(form));
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    status.textContent = payload.message;
    document.querySelector("#email")?.focus();
    return;
  }
  status.textContent = "Login concluído.";
  window.location.assign(payload.redirect);
});
