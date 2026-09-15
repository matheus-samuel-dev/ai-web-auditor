# Validação funcional final — AI Web Auditor

Execuções em 14/09/2026; conferência de persistência retomada em 15/09/2026. Escopo exclusivamente funcional, sem redesign ou alterações de CSS/identidade visual. Evidências locais em `storage/validation/`, excluídas do Git por conterem dados e artefatos de execução.

## 1–3. Bugs encontrados, causas e correções

| Problema observado | Causa raiz | Correção e prova |
|---|---|---|
| Cadastro aceitava `usuario@dominio` | `@Email` e validação do navegador não exigiam domínio completo | Bean Validation + padrão complementar no backend; validação imediata no frontend; HTTP 400 e testes dos exemplos solicitados |
| Não havia entrada demo sem senha conhecida | Fluxo só oferecia autenticação manual | Conta idempotente no backend, senha aleatória só no servidor e autenticação pelo serviço normal de login/JWT |
| Auditoria de site inacessível podia produzir relatório concluído | Pipeline continuava mesmo sem nenhuma página validada pelo browser | Falha terminal quando nenhuma página foi analisada; conexão recusada e timeout verificados |
| Redirect podia atingir endereço privado antes de ser rejeitado | Interceptação de rotas Playwright não interceptava cada salto da navegação | Proxy por auditoria valida DNS/endereço antes da conexão e usa o IP validado. Teste com servidor privado contador: **zero acessos** tanto no Chromium quanto no Lighthouse |
| Links saudáveis podiam aparecer quebrados | HEAD rejeitado sem GET alternativo; Range desnecessário; erro de transporte convertido em HTTP 599 | GET alternativo, sem Range; transporte inconclusivo vira limitação, não broken link; teste HEAD 405/GET 200 e conexão recusada |
| Lighthouse podia constar concluído com erro interno | `runtimeError` do resultado não era verificado | Erro parcial com scores nulos; HTTP 404/500 preservam screenshots e demais dados |
| Lighthouse consumia todo o prazo e descartava dados válidos | Prazo da etapa não reservava tempo para consolidar artefatos | Orçamento considera o prazo global restante e reserva 15 segundos para as etapas finais; repetição HTTP 500 concluída |
| Achados axe apareciam sem URL | Evidência possuía pageId, mas não preenchia o campo URL persistido | Associação com a página real; URL visível no relatório |
| Recomendações determinísticas sugeriam corrigir links mesmo com zero broken links | Listas fixas no fallback | Quick wins/prioridades derivados das recomendações dos findings reais |
| Comparação dizia “Regrediu” durante processamento | Cobertura parcial/zero era comparada com a execução concluída | Comparação disponível apenas após COMPLETED; teste para PENDING/RUNNING/FAILED/CANCELLED |
| Cancelamento ocasionalmente retornava conflito com o progresso | Escritas simultâneas usavam versões diferentes da mesma auditoria | Lock de linha nas transações curtas de cancel/retry/progresso/conclusão/falha; cinco corridas reais aprovadas e suíte PostgreSQL aprovada |
| Histórico mostrava “100%” na coluna score quando Lighthouse falhava | Fallback usava progresso como pontuação | “Não medido” quando score é nulo; teste de regressão |
| TBT de `6,200 ms` era classificado “Bom” | Separador de milhar era interpretado como decimal | Parsing corrigido; teste para milhar, segundos localizados e CLS; UI final mostra “Ruim” |
| Retry logo após restart do worker ainda dizia indisponível | JVM conservava resolução DNS negativa de quando o container estava parado | Configuração suplementar no Docker desabilita somente o cache DNS negativo; retry real após healthcheck passou |

A limitação de interceptação de redirects consta na [documentação do Playwright](https://playwright.dev/docs/api/class-page). A configuração de proxy aplica a regra explícita de loopback descrita pelo [Chromium](https://chromium.googlesource.com/chromium/src/%2Bshow/main/net/docs/proxy.md). O cache DNS negativo é uma propriedade documentada do [Java](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/doc-files/net-properties.html). Não foram removidos JWT, validação de certificados, ownership de auditorias ou bloqueios SSRF.

## 4. Acesso demo

- Botão **Entrar como usuário demo** na tela de login.
- `POST /api/auth/demo` autentica normalmente; token não é fixo. AuthContext salva a sessão pelo mesmo mecanismo do login comum.
- Conta reservada `demo@demo.ai-web-auditor.example`; senha aleatória permanece no backend e é armazenada com BCrypt. Seed de usuário idempotente a cada inicialização habilitada.
- `APP_DEMO_ENABLED=true` no Compose; padrão desabilitado fora dele.
- Dados reais: dashboard, projetos, histórico, relatórios, comparação e falhas controladas persistidos. `node scripts/seed-demo.mjs` provisiona pelo menos duas auditorias públicas reais, reaproveitando as existentes.
- Ciclo de navegador **demo → logout → demo** aprovado. Dados também permaneceram após rebuild/restart do backend.

## 5. E-mail e autenticação

Os cinco inválidos solicitados foram rejeitados pelo backend em cadastro e login, totalizando dez respostas HTTP 400 com `fieldErrors.email`: `usuario@`, `usuario@dominio`, `@dominio.com`, `usuario@@dominio.com`, `usuario dominio@gmail.com`.

`usuario@gmail.com` e `nome.sobrenome@empresa.com.br` estão entre os casos aceitos nos testes. Um cadastro real com endereço único `validation.…@example.com` também gerou sessão, passou por login com senha e `/auth/me`. Outro usuário não consegue abrir auditoria da conta demo (HTTP 404).

No navegador, `usuario@dominio` mostrou imediatamente “Informe um email válido, com domínio completo (ex.: nome@empresa.com).” e manteve o submit desabilitado.

## 6–7. Auditorias E2E e URL pública

URL: **https://example.com/**. Resultados vêm de Chromium, axe e Lighthouse reais, sem OpenAI e sem respostas simuladas.

| Auditoria | Geral | Performance | Accessibility | SEO | Best Practices | Findings |
|---|---:|---:|---:|---:|---:|---:|
| `0a893fbe-6576-4ff6-ad73-8c916d177009` | 90 | 86 | 96 | 80 | 96 | 17 |
| `903c32ce-947e-4a1f-abce-fd9f43fdf7ed` | 88 | 79 | 96 | 80 | 96 | 18 |
| `4d37307b-5721-4d3e-94f6-717fbd8bf580` — refresh real | 85 | 67 | 96 | 80 | 96 | 18 |
| `c9f668d3-492d-4b51-a350-a1af18700378` — retry final | 83 | 60 | 96 | 80 | 96 | 9 |

Os scores de laboratório variam com carga da máquina e configuração de viewports; não foram ajustados manualmente. Há execuções com duas viewports e com o conjunto padrão mais amplo. Cobertura e dispositivos ficam explícitos no relatório.

Progresso real observado: `PENDING/QUEUED → BOOTING_PIPELINE → BOOTING_BROWSER → DISCOVERING_PAGES → AUDITING_DESKTOP → AUDITING_MOBILE → RUNNING_LIGHTHOUSE → CHECKING_LINKS → BUILDING_JSON/BUILDING_PDF → COMPLETED`. Etapas curtas podem acontecer entre duas amostras de polling. Arquivos de evidência guardam os estados efetivamente capturados, sem inventar snapshots intermediários.

Criação pelo wizard foi executada em `c2230fdf-1331-48bf-840b-a27a949fc9d6`. Na execução `4d37307b-…`, o navegador mostrou mobile em 52%; houve refresh durante RUNNING, recuperação em Lighthouse/66% e conclusão automática em 100%. Depois: logout, novo login demo, histórico e reabertura do mesmo relatório.

## 8. Screenshots e Playwright

Desktop e mobile reais, endpoints autenticados HTTP 200, arquivos PNG íntegros e associados ao UUID correto. Na auditoria de refresh, o DOM confirmou imagens carregadas com dimensões **1440×900** e **360×800**. O visualizador desktop também abriu a captura real. Antes da conclusão a interface mostra “Gerando”, sem solicitar um 404 como estado normal.

Inicialização de Chromium, navegação, erros de página, redirecionamento privado, conexão recusada, timeout e fechamento em `finally` foram exercitados. A suíte isolada força falha de inicialização e falha de screenshot mobile, verificando fechamento e preservação de desktop/Lighthouse/PDF/JSON. Ausência de screenshot fica registrada como limitação; não é apresentada como evidência disponível.

## 9–10. Lighthouse, findings, links e console

Lighthouse executado com o Chromium instalado na imagem, quatro categorias, parsing e persistência. Métricas de FCP/LCP/TBT/CLS/Speed Index/TTI visíveis quando retornadas. Falha/timeout isolado do Lighthouse não cria score fictício e não destrói as capturas válidas.

Findings têm categoria, severidade, título, descrição, recomendação e origem (axe-core, Lighthouse, Playwright, segurança passiva), com URL/selector/evidência quando aplicável. O teste de regressão de enums persiste explicitamente `FUNCTIONAL`, `OPPORTUNITY` e `CANCELLED`; as execuções reais também persistiram categorias e estados de validação produzidos pelos motores. A migration V3 de alinhamento de constraints foi validada no PostgreSQL.

`example.com` retornou zero broken links e zero erros de console. A fixture final `77bfdf79-0210-48be-87ae-f94eb2ebddd5` retornou **12 findings, 1 broken link HTTP 404 e 4 erros de console**. Esses dados foram persistidos; o verificador não converte falha própria de transporte em HTTP 599.

## 11–12. PDF, JSON e estados de artefatos

PDFs baixados por endpoint HTTP 200 e abertos com leitor/parser. O PDF `4d37307b-…` tem **quatro páginas**, renderizadas e inspecionadas; URL, scores, findings e screenshots correspondem ao relatório. Metadados contêm o UUID da auditoria. O botão do relatório preparou o download com o nome correto.

JSON baixado por endpoint HTTP 200, parse válido, schema e metadata coerentes, UUID correto, sem token JWT/senha usados no teste. O botão JSON mostrou confirmação com o mesmo UUID.

Estados exercitados: `GENERATING`, `AVAILABLE`, `FAILED`, `CANCELLED`, `UNAVAILABLE`. Um PDF foi renomeado temporariamente dentro de sua pasta: a API passou a `UNAVAILABLE`/URL nula e voltou a `AVAILABLE` após restauração em `finally`. JSON de execução falha/cancelada pode continuar disponível porque é uma exportação real do estado persistido, gerada pela API.

Evidências principais:

- [PDF real](../storage/validation/4d37307b-5721-4d3e-94f6-717fbd8bf580-report.pdf)
- [JSON real](../storage/validation/4d37307b-5721-4d3e-94f6-717fbd8bf580-export.json)
- [Desktop](../storage/validation/4d37307b-5721-4d3e-94f6-717fbd8bf580-desktop.png) e [mobile](../storage/validation/4d37307b-5721-4d3e-94f6-717fbd8bf580-mobile.png)
- [Verificações finais de ownership, arquivos e cancelamento](../storage/validation/final-checks.json)

## 13–15. Histórico, comparação e retry

Histórico: 46 combinações reais de busca, status, ordenação, página, tamanho, dispositivo e score receberam HTTP 200 no PostgreSQL. Casos com retorno vazio, múltiplos registros, COMPLETED, FAILED, RUNNING, PENDING e CANCELLED também passaram. Navegação no histórico e abertura do relatório foram verificadas no browser.

Comparação da primeira dupla: geral **90 → 88 (−2)**; Performance **86 → 79 (−7)**; Accessibility/SEO/Best Practices sem delta; cobertura **17% → 17%**. O backend restringe à mesma URL normalizada e respeita baseline válida. A versão final conta novos findings por identidade de tipo/título/URL/dispositivo/selector; ausência de finding não é tratada automaticamente como resolução. Comparação entre URLs diferentes é rejeitada/omitida.

Retry final `c9f668d3-…`: worker parado → FAILED; worker reiniciado e saudável → retry → scores nulos, findings vazios e artefatos GENERATING → nova análise real → COMPLETED. A limpeza de dados antigos (scores, findings, referências de artefatos, links, console) também passou nos testes de backend com dados antigos preenchidos.

## 16. Falhas e segurança

| Cenário | Resultado comprovado |
|---|---|
| URL vazia/malformada, domínio `.invalid` | HTTP 400 tratado |
| localhost, 127.0.0.1, ::1, redes privadas, metadata | Bloqueio mantido no backend/worker |
| Redirect para privado | FAILED; teste de transporte confirmou zero hits no destino privado |
| Conexão recusada/site offline | FAILED com mensagem tratada |
| Timeout de navegação | FAILED dentro do prazo, sem execução eternamente RUNNING |
| HTTP 404 / 500 | COMPLETED com erros HTTP reais e limitações; Lighthouse FAILED, capturas preservadas |
| Falha de inicialização Playwright | Falha terminal e cleanup |
| Falha/timeout Lighthouse | Falha parcial sem scores inventados |
| Falha screenshot mobile | Limitação explícita; demais evidências preservadas; cleanup confirmado |
| auditor-service indisponível | FAILED; retry posterior concluído |
| Cancelamento concorrente | CANCELLED persistido, sem ser sobrescrito por progresso |

Rodada final completa: [failures-final.log](../storage/validation/failures-final.log), terminando em **ALL FAILURE TESTS PASSED**. IDs em [failure-ids.json](../storage/validation/failure-ids.json). Suíte real do worker: [worker-integration-final.log](../storage/validation/worker-integration-final.log), **6/6**.

Polling revisado: uma chamada por ciclo após a anterior terminar, intervalo de 2,5 s, AbortController ao sair, encerramento em estados terminais, limite global de 20 minutos e limite de falhas de comunicação. Testes verificam ausência de sobreposição, término em COMPLETED/FAILED e recuperação após reabrir. O refresh real citado acima confirmou a persistência. Não há promessa de cobrir toda condição possível de rede; os cenários solicitados foram efetivamente exercitados.

## 17–20. PostgreSQL, Docker, testes e builds

PostgreSQL **16.14** real: testes em `aiwa_validation` e E2E em `ai_web_auditor`. Flyway validou V1/V2/V3 e o schema foi verificado pelo Hibernate. Nenhuma alteração manual de schema nem migration nova foi necessária.

Stack reconstruída: PostgreSQL, backend, auditor-service, frontend e fixture. Healthchecks e comunicação foram exercitados pelo fluxo real; restart do worker revelou e permitiu corrigir o cache DNS negativo. O Dockerfile do backend agora executa `mvn clean package` com testes; `-DskipTests` permanece somente no comando de download de dependências, não no build/teste.

| Verificação final | Resultado | Evidência |
|---|---|---|
| Backend `mvn clean test` | 25 testes, zero falhas/erros/skips | `backend-final-test.log` |
| Backend `mvn clean package` | BUILD SUCCESS, 25 testes | `backend-final-package.log` |
| Mesma suíte contra PostgreSQL | 25 testes, zero falhas/erros/skips | `backend-postgres-tests-final.log` |
| Frontend Vitest | 40 testes aprovados | `frontend-tests.json` |
| Frontend TypeScript + Vite | Build aprovado | `frontend-build.log` |
| Auditor-service testes existentes | 10 aprovados | `auditor-tests-final.log` |
| Auditor-service TypeScript/build | Aprovado | `auditor-build-final.log` |
| Worker real em Docker | 6 testes aprovados | `worker-integration-final.log` |

Logs acima estão em `storage/validation/`. Os últimos ajustes de Docker/DNS reutilizam a camada de pacote já testada; foram comprovados adicionalmente pelo retry real. Não foram ignorados testes para obter build verde.

## 21. Arquivos alterados

O conjunto completo consta em [functional-validation-files.txt](functional-validation-files.txt). Grupos principais:

- Backend: autenticação/demo, DTOs de e-mail/comparação, locks de auditoria, testes de integração, configuração de demo e DNS, Dockerfile.
- Auditor-service: proxy SSRF, pipeline/Lighthouse, verificação de links, recomendações determinísticas e metadados PDF.
- Frontend: login/demo/AuthContext, validação de e-mail, relatório/comparação/métricas, score do histórico e testes de regressão/polling.
- Stack e evidências: Compose, fixture, scripts de seed/validação, README e este relatório.

## 22. Limites e pendências

Não se infere resolução automática de findings ausentes; a comparação informa novos findings e explicita essa limitação. Scores Lighthouse são medições de laboratório, sensíveis à carga da máquina. Fluxos bloqueados por autenticação/CAPTCHA ou por segurança não são declarados aprovados; cobertura e limitações continuam visíveis. O modo demo usa uma conta compartilhada para esta stack de backend único.

Conferência em **15/09/2026 às 06:35 (America/Sao_Paulo)**: Docker Desktop iniciado novamente, cinco serviços `healthy`, zero reinícios automáticos registrados e nenhum processo Chromium remanescente. PostgreSQL preservou **28 auditorias da conta demo, zero ativas**, e o relatório `4d37307b-…` manteve os quatro artefatos `AVAILABLE`. O seed foi executado duas vezes e reaproveitou os dados. Evidências: [persistence-final.json](../storage/validation/persistence-final.json) e [demo-seed-final.log](../storage/validation/demo-seed-final.log).

Não há pendência funcional bloqueante identificada nos critérios solicitados. A conclusão se refere à stack local validada e aos cenários executados; não é uma certificação de todo site possível nem uma implantação pública.

**FUNCIONALMENTE PRONTO**
