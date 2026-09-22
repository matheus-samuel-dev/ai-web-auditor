# Validação de autenticação — 22/09/2026

Correção aplicada e validada em `https://ai-web-auditor.18.231.73.103.sslip.io`.
Escopo: autenticação, configuração de origem, sessão, validação e mensagens de erro.

1. **Causa raiz.** O container do backend na AWS recebia `APP_FRONTEND_URL=http://localhost:5175`, enquanto o navegador enviava a origem HTTPS pública. O filtro CORS do Spring recusava a requisição antes do controller. O cliente tentava interpretar a resposta textual como JSON e mostrava o fallback genérico. `git blame` aponta a configuração fixa ao commit inicial `9d0b72b`; ela continuava no `95b7d94`. Não há evidência de uma regressão recente de senha, JWT ou migration: havia uma configuração de implantação incompatível com a origem pública, não coberta pela validação local.

2. **Reprodução anterior.** POST `/api/auth/login`, `/api/auth/register` e `/api/auth/demo` retornavam **403**, corpo `Invalid CORS request`, com a origem HTTPS. Payload do login: campos `email` e `password`; senha omitida nas evidências. Tempos medidos pela API: login 3937 ms, demo 48 ms, cadastro 16 ms. O navegador mostrava “Não foi possível concluir a requisição.” Os logs Nginx confirmaram os POSTs 403. As mesmas credenciais, sem Origin, retornavam login 200 e `/api/auth/me` 200. Backend e banco estavam acessíveis e saudáveis.

3. **Correção.** Compose agora lê `APP_FRONTEND_URL` do ambiente, mantendo localhost como padrão local. O `.env` remoto recebeu a origem HTTPS exata. Não foi usado wildcard CORS. JWT, BCrypt, endpoints privados, segredo e banco foram preservados. O filtro JWT ignora somente os três POSTs públicos de autenticação, impedindo interferência de um Bearer antigo. O frontend também não envia Authorization nesses POSTs. Respostas atrasadas de uma sessão anterior não devem apagar uma sessão nova; isso recebeu testes de regressão. Os formulários impedem envio simultâneo e encerram loading em `finally`.

4. **Login existente.** Validado pela API e pelo navegador com a conta fornecida: login → dashboard com o usuário e suas duas auditorias existentes → refresh → sessão recuperada → logout. O usuário manteve ID e data de criação; hash BCrypt com 60 caracteres e prefixo `$2a$`. Nenhuma redefinição de senha foi realizada. O teste de integração também verifica explicitamente a preservação do hash após autenticação.

5. **Cadastro.** Cadastro real na interface: nome, e-mail válido e senha → HTTP 201 → sessão legítima → dashboard da nova conta. Persistência confirmada por SELECT no PostgreSQL de produção. Conta de teste do navegador: `auth.browser.1790091813157@example.com`, ID `671a178a-01ef-421c-81d7-c028cbc21894`. Uma segunda conta foi criada pela validação de API: `auth.validation.1790091726512@example.com`.

6. **Login da conta nova.** Após logout, o navegador autenticou novamente a conta recém-criada e abriu seu dashboard. Os logs registraram POST login 200 às 15:44:00 UTC. A validação pela API também verificou correspondência entre o ID criado, o login posterior e `/auth/me`.

7. **Demo.** Botão → POST `/api/auth/demo` 200 → JWT emitido pelo backend → dashboard como Usuário demo. Navegação em Projetos e Configurações, logout e novo login demo passaram. O seed reutilizou o usuário existente, ID `7564908f-c2e5-4bb4-9a02-7f5dabf7af6c`. Não há token ou senha demo hardcoded no frontend.

8. **E-mail e senha.** Frontend e backend continuam rejeitando `usuario@`, `usuario@dominio`, `@dominio.com`, `usuario@@dominio.com` e espaços no endereço. Os testes aceitam `usuario@gmail.com`, `nome.sobrenome@empresa.com.br` e endereço com `+tag`. Backend usa Bean Validation (`@Email`, padrão de domínio completo e limite de comprimento). E-mails inválidos retornam 400 também sem frontend. A interface exibiu feedback imediato e bloqueou cadastro inválido. Cadastro exige 8–72 caracteres e até 72 bytes UTF-8, sem obrigatoriedade de caracteres especiais; login preserva a compatibilidade com senhas existentes. Limites de senha recebem mensagem explícita.

9. **Mensagens.** 401: “E-mail ou senha inválidos.”; cadastro 409: “Já existe uma conta com este e-mail.”; 400: mensagens de validação; falha de conexão/502/503/504: “Não foi possível conectar ao servidor. Tente novamente em instantes.”; timeout: “A solicitação demorou mais que o esperado.”; erro inesperado: fallback genérico. A resposta textual de rejeição de origem recebe mensagem específica de configuração. Nenhum stack trace é mostrado. Senha errada, usuário inexistente e cadastro duplicado foram verificados na interface, com botões disponíveis novamente após falha.

10. **Testes.** `mvn clean test`: 28 testes, zero falhas/erros/ignorados. `mvn clean package`: sucesso, executando novamente os 28 testes. `AuthCorsIntegrationTest` + `BackendApiIntegrationTest` executados adicionalmente contra PostgreSQL 16.14 no banco isolado `aiwa_validation`: 25 testes, zero falhas/erros/ignorados; Flyway validou V1–V3. Frontend: 55 testes em 7 arquivos passaram com `npm run test:run -- --maxWorkers=1`. A primeira execução concorrente teve um timeout de 5 segundos em teste de histórico; a suíte completa foi repetida com um worker e passou sem ignorar ou alterar esse teste. Os testes cobrem erros, timeout, indisponibilidade, sessão inválida, token antigo, loading e os formulários.

11. **Builds e Docker.** TypeScript (`tsc -b`) e build Vite passaram. Backend e frontend foram reconstruídos na AWS com `docker compose build backend frontend`; a imagem backend executou seus testes durante o build. Ativação com `docker compose up -d --no-deps --wait backend frontend`. Backend, frontend e PostgreSQL saudáveis, restart count zero, `/actuator/health` UP. PostgreSQL e demais serviços mantiveram seus containers/dados. Não houve alteração de schema ou migration nova.

12. **Comprovação HTTP e navegador.** O script `scripts/validate-auth.mjs` passou 25 verificações na API pública, incluindo origem legítima, Bearer antigo, `/me`, cadastro, duplicidade, validações, demo e proteção privada. Não houve 500 de autenticação. A origem externa não autorizada continuou recebendo 403. No navegador, login existente 200, cadastro 201, novo login 200, demo duas vezes 200, erros de credenciais 401 e duplicidade 409 foram correlacionados com os logs Nginx. Nenhuma requisição legítima de autenticação foi rejeitada por CORS. O Console capturado retornou lista vazia de erros/avisos. Não foi observado loading infinito, tela branca ou rejeição de Promise sem tratamento.

13. **Arquivos alterados.**

    - `.env.example`, `docker-compose.yml`, `README.md`: origem configurável e instruções de implantação.
    - `backend/src/main/java/com/aiwebauditor/auth/AuthService.java`: mensagens de credenciais/duplicidade.
    - `backend/src/main/java/com/aiwebauditor/config/JwtAuthenticationFilter.java`: independência dos endpoints públicos em relação a Bearer antigo.
    - `backend/src/test/java/com/aiwebauditor/audit/AuthCorsIntegrationTest.java`: regressão CORS/autenticação.
    - `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`: token, erros, timeout e respostas atrasadas.
    - `frontend/src/context/AuthContext.tsx`: proteção da sessão nova.
    - `frontend/src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `AuthPages.test.tsx`: validação, submit, loading e testes.
    - `frontend/src/utils/password.ts`: regras de senha compartilhadas entre formulários.
    - `scripts/validate-auth.mjs`: validação de API com evidências sanitizadas.
    - Este relatório. No servidor, também foi configurado `APP_FRONTEND_URL` no `.env`, sem versionar secrets.

14. **Limites e pendências reais.** Não há bloqueio funcional observado nos três fluxos de autenticação. A conta demo na AWS está sem auditorias/projetos; isso não impede login ou navegação e pertence à preparação de conteúdo demo, fora desta rodada exclusivamente de autenticação. As duas contas de validação permanecem no banco, sem exclusão de dados. Indisponibilidade, timeout e localStorage inválido foram cobertos por testes automatizados; não foi provocada uma interrupção do backend público. A ferramenta de navegador disponibilizou Console e interação real, mas não a aba Network do DevTools: os detalhes HTTP foram obtidos pela API e pelos logs Nginx correlacionados, sem alegar captura HAR.

Evidências locais (ignoradas pelo Git, senhas e JWTs omitidos nos JSONs):

- `storage/validation/auth-2026-09-22/api-before.json` e `api-after.json`.
- `storage/validation/auth-2026-09-22/remote-after.log`.
- `storage/validation/auth-2026-09-22/backend-test.log`, `backend-package.log`, `backend-postgres-tests.log`, `postgres-cors-test.txt`, `postgres-api-test.txt`.
- `storage/validation/auth-2026-09-22/frontend-tests.log`, `frontend-build.log`, `docker-build.log`, `docker-deploy.log`.

**LOGIN, CADASTRO E ACESSO DEMO VALIDADOS NA APLICAÇÃO PUBLICADA.**
