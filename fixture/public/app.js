const menuButton = document.querySelector(".menu-trigger");
const navigation = document.querySelector("#main-nav");
const modalBackdrop = document.querySelector("#details-modal");
const openModal = document.querySelector("#open-modal");
const closeModal = document.querySelector("#close-modal");
const searchForm = document.querySelector("#search-form");
const searchStatus = document.querySelector("#search-status");

menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open));
  navigation?.classList.toggle("open", !open);
});

function showModal() {
  modalBackdrop.hidden = false;
  closeModal?.focus();
}

function hideModal() {
  modalBackdrop.hidden = true;
  openModal?.focus();
}

openModal?.addEventListener("click", showModal);
closeModal?.addEventListener("click", hideModal);
modalBackdrop?.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) hideModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop?.hidden) hideModal();
});

searchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(searchForm);
  searchStatus.textContent = "Pesquisando…";
  const response = await fetch(`/api/search?q=${encodeURIComponent(data.get("q") || "")}`);
  const payload = await response.json();
  searchStatus.textContent = payload.results.length ? payload.results[0].title : "Nenhum resultado.";
});

// Falhas intencionais e documentadas para o auditor determinístico.
console.error("FIXTURE_CONSOLE_ERROR: erro controlado para validação.");
fetch("/api/error").catch(() => undefined);
