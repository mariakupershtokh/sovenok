# AGENTS.md

Инструкции для агентов и контрибьюторов, работающих с этим репозиторием.

## О проекте

«Совёнок» — статическое веб-приложение (HTML, CSS, JavaScript) для поиска обходов шахматной доски.
Сборщик — Vite, UI-фреймворков и серверной части нет. Итог сборки — каталог `dist/`.

## Команды

```sh
npm install       # установка зависимостей
npm run dev       # dev-сервер Vite на http://127.0.0.1:5173/
npm test          # тесты (node --test), должны проходить перед пушем
npm run build     # production-сборка в dist/
npm run preview   # локальный просмотр собранной версии
```

Требования: Node.js 20.19+ или 22.12+.

## Структура

- `index.html` — разметка и UI.
- `src/main.js` — точка входа, работа с DOM.
- `src/solver.worker.js` — Web Worker с поиском обхода.
- `solver.js` — алгоритм решения (общий код для UI и тестов).
- `solver.test.js` — тесты solver'а.
- `src/style.css` — стили.
- `public/` — статические файлы, копируются в корень `dist/`.
- `vite.config.js` — конфигурация сборки (`base: "./"`, относительные пути).

## Публикация сайта

**Публиковать сайт можно только через GitHub Actions.** Единственный поддерживаемый способ —
workflow `.github/workflows/deploy.yml` («Deploy to GitHub Pages»).

- Триггеры: `push` в ветку `main` и ручной запуск `workflow_dispatch`.
- Пайплайн: `npm ci` → `npm test` → `npm run build` → `upload-pages-artifact` → `deploy-pages`.
- Источник GitHub Pages — GitHub Actions (`build_type: workflow`), не отдельная ветка.
- Адрес сайта: https://mariakupershtokh.github.io/sovenok/

Правила:

1. Не деплоить вручную: не создавать и не пушить ветку `gh-pages`, не загружать `dist/` через API,
   не коммитить артефакты сборки.
2. Не менять источник Pages на «Deploy from a branch» и не отключать Actions.
3. Любой пуш в `main` обязан приводить к успешной пересборке и публикации; упавшие тесты
   останавливают деплой — это ожидаемое поведение, чинить нужно тесты и код, а не обходить шаг.
4. Перед пушем локально прогонять `npm test` и `npm run build`.

Ручной запуск публикации:

```sh
gh workflow run deploy.yml --repo mariakupershtokh/sovenok
gh run list --repo mariakupershtokh/sovenok --workflow deploy.yml
gh run watch --repo mariakupershtokh/sovenok
```

После успешного запуска проверьте, что сайт отвечает `200`:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://mariakupershtokh.github.io/sovenok/
```

## Git

- `origin` — форк `mariakupershtokh/sovenok`, сюда пушим.
- `upstream` — оригинал `AlexeyKupershtokh/sovenok`, отсюда забираем обновления.

```sh
git fetch upstream && git merge upstream/main   # подтянуть обновления оригинала
git push origin main                            # пуш в форк, запускает публикацию
```

## Стиль кода

- Ванильный JS (ES-модули), без фреймворков и новых зависимостей без необходимости.
- Текст интерфейса и комментарии — на русском.
- `vite.config.js` держит `base: "./"`, чтобы сайт работал в подкаталоге `/sovenok/`.
