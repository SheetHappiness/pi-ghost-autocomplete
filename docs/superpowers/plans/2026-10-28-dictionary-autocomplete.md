# Dictionary-first autocomplete — план реалізації

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. Цей документ описує запропонований дизайн; реалізація, subagents, commit, push і публікація ним не запускаються. GPT-6 Astra для subagents заборонений.

**Goal:** Показувати впевнені словникові завершення без inference, залишаючи SmolLM2 для неоднозначних випадків.

**Architecture:** TypeScript-словник із загальними частотами та персональною статистикою; `HybridPredictor` обгортає чинний `LazyPredictor`. Controller перевіряє швидкий словник перед чергою LLM. Фонове завантаження SmolLM2 на `session_start` зберігається.

**Tech Stack:** Наявні Node.js >=22.19.0, TypeScript, node:test. Без нових runtime-залежностей і змін Rust/N-API.

**Spec:** Запит користувача від 2026-10-28 та запропонований контракт у розділах 1–5 цього документа. Числа нижче — стартові параметри для перевірки, а не доведена якість ranking.

## Global Constraints

- Робота лише в standalone `pi-ghost-autocomplete`; Pi core не змінювати.
- `session_start → editor ownership → runtime.ready()` у background зберігається.
- Словник і LLM використовують чинний prose gate; код, paths, slash commands та paste markers не стають словниковими запитами.
- Підказка лише дописує суфікс одного слова; нічого не замінює автоматично.
- Наявні Tab/Right, Escape, projection, session reset та editor ownership зберігаються.
- Персональна статистика локальна; автоматично старі журнали сесій не імпортувати.
- Завантаження та запис словника асинхронні; у render/update немає файлового I/O.

## Review Focus

- Повільний LLM-запит не затримує новий dictionary hit; старий результат не перекриває його.
- Навчання до завершення load не губиться; shutdown не залишає background writer після close.
- NFC, апострофи та регістр не призводять до неправильного suffix або переписування prefix.
- Два процеси Pi не перезаписують персональні зміни один одного.
- Dictionary load/write failure або model startup failure не вимикають справну частину гібрида.

## 1. Що підтверджено в поточному коді

- `src/pi-ghost-autocomplete.ts`: `runtime.ready()` викликається після встановлення editor, у background; `input` передає interactive prompts через `observe`.
- `src/runtime.ts`: модель запускається single-flight; observations буферизуються до готовності.
- `src/completion/query.ts`: prefix має щонайменше дві літери; `before` обмежений 2000 UTF-16 units; prose gate уже є.
- `src/completion/controller.ts`: одна активна операція та найновіша queued; є cache, Escape tombstone, generation та projection. Будь-який backend exception зараз вимикає controller.
- `native/predictor/src/smollm/mod.rs`: `MEMORY_UNITS = 1500`; recent prompts зберігаються у session state; `feedback` моделі є no-op.
- `src/paths.ts`: state моделі прив'язаний до session ID. Персональний словник потребує окремого шляху, спільного між сесіями.

## 2. Попередні підходи та вибір

| Джерело | Підтверджена поведінка | Що беремо |
| --- | --- | --- |
| [Fish tutorial](https://fishshell.com/docs/current/tutorial.html) | Autosuggestions використовують history, paths і completions; користувач приймає пропозицію явно | Спершу дешеві локальні джерела; зберегти явне прийняття |
| [VS Code IntelliSense](https://code.visualstudio.com/docs/editing/intellisense#suggestion-selection) | Є locality bonus та `recentlyUsedByPrefix` | Враховувати повторне прийняття слова для конкретного prefix |
| [Android LatinIME DictionaryFacilitatorImpl](https://android.googlesource.com/platform/packages/inputmethods/LatinIME/+/master/java/src/com/android/inputmethod/latin/DictionaryFacilitatorImpl.java) | Окремі main/user/history dictionaries; історія приймає n-gram context і timestamps | Відокремити загальні частоти від персонального навчання |

Це аналіз відкритого LatinIME, а не твердження про сучасні закриті Gboard чи Apple Keyboard. Запропоновані нижче score та пороги — наш дизайн, не алгоритм цих продуктів.

Розглянуті варіанти:

1. Лише frequency dictionary: простий і швидкий, але слабко адаптується до користувача.
2. **Common + personal dictionary → confidence gate → LLM:** рекомендований; дає швидкий шлях і зберігає контекстну модель.
3. Dictionary та LLM паралельно на кожний prefix: швидко дає першу відповідь, але inference не економиться, можливе мерехтіння.

Пропозиція — варіант 2. Змішувати числову confidence словника та LLM не потрібно: це різні оцінки.

## 3. Контракт першої версії

### Дані та пошук

- Загальний словник: англійський, до 20 000 найчастіших допустимих слів, packaged asset. Це покриття для прикладу `becau → because`, не обмеження мови персонального словника.
- Персональний словник: Unicode prose words з нових submitted interactive prompts; max 20 000 слів та 20 000 пар prefix/word. Без автоматичного сканування репозиторію або старих chats.
- Відкидати code spans/fences, paths, URL, digits, slash commands, paste markers і code-like tokens через спільні правила prose gate. Одна поява слова в одному submitted prompt дає максимум +1 до count.
- Слова довжиною 2–64 Unicode code points. Prefix від двох літер відповідно до чинного query gate. Зберігати NFC; апострофи `'` та `’` зводити до спільного lookup key.
- Підтримати lowercase, Title Case, UPPERCASE. Для mixed case потрібне буквальне співпадіння; suffix додається лише якщо відтворена форма дослівно починається з оригінального prefix. При неможливості — fallback.
- Для v1 використати sorted array + binary-search prefix range; перебирати весь range, а не лише перші N алфавітних слів. Trie вводити лише за результатами benchmark.
- Поточне слово без продовження не є completion-кандидатом. Якщо prefix уже є відомим повним словом, словник утримується від його подовження та передає запит LLM.

### Ranking та впевненість

Для всіх допустимих кандидатів обчислювати детермінований score:

`score = commonFrequency × 1e6 + decayedPromptCount + 3 × decayedPrefixAcceptCount`

- `commonFrequency` — нормалізована corpus frequency; для personal-only слова 0.
- Personal counts зберігати як effective count + updatedAt; decay `2^(-elapsedDays/30)`. Ін'єктувати clock у тести.
- Прийняття Tab/Right підсилює саме пару `(prefix, word)` один раз. Саме відображення нічого не навчає.
- `accepted=false` не трактувати як достовірну негативну оцінку: controller так позначає також звичайну зміну контексту. Escape блокує повтор для поточного snapshot чинним механізмом.
- Tie-break: score descending, потім нормалізоване слово у code-point order.
- Стартовий confidence gate: prefix від 3 літер; top score >=1; `top/sum(all candidate scores) >=0.85`; `top/runnerUp >=4`. Для одного кандидата margin вважається нескінченним; нульова сума означає abstain.
- Єдиний кандидат також має мати common frequency >=1e-6, або щонайменше два різні submitted prompts, або одне явне прийняття для цього prefix. Випадкове одноразове слово не стає впевненою підказкою.
- Усі пороги винести у `DEFAULT_DICTIONARY_POLICY`. Це heuristic confidence, не калібрована ймовірність. Перед випуском перевірити на окремому evaluation set.
- `becau` має давати `se` без виклику model.complete на реальному common asset. `implementa` із близькими кандидатами має передаватися LLM; не зашивати окремі prefixes у логіку.

### Lifecycle та помилки

- `HybridPredictor.ready()` запускає dictionary load та `LazyPredictor.ready()` незалежно. Для dictionary hits готовність LLM не потрібна.
- У `Predictor` додати optional `fastComplete?(before: string, prefix: string): Suggestion | undefined`. `undefined` означає miss/not-ready/abstain; успішний результат уже пройшов dictionary gate та має `confidence: 1` для сумісності controller, без інтерпретації як ймовірності.
- Controller викликає `fastComplete` до перевірки активного LLM-запиту. Hit одразу кешується, queued запит очищається; раніше запущений LLM може завершитися, але не перекриває новий hit.
- `HybridPredictor.complete()` повторно перевіряє словник, інакше викликає LLM. Model errors ловляться в обгортці, повідомляються один раз і дають `null`; dictionary продовжує працювати. Dictionary errors залишають LLM доступним.
- `observe()` навчає словник і передає текст моделі незалежно; model readiness не затримує dictionary learning. Під час load observations накопичуються та застосовуються після snapshot.
- `/ghost status` показує dictionary readiness і model readiness окремо; `/ghost retry` повторно створює обидва джерела. `/ghost off` та втрата editor ownership закривають обидва.
- Не обіцяти миттєвого результату до dictionary load; поки він не готовий, діє fallback.

### Persistence

- Додати `personalDictionaryPath()` у `src/paths.ts`: `${PI_GHOST_STATE_DIR || <agentDir>/ghost-autocomplete}/dictionary/personal-v1.json`; існуючий `stateDirectory(session)` не змінювати.
- JSON v1 містить лише vocabulary, effective counts/timestamps і prefix accept counts; raw prompts не записувати в новий словниковий файл.
- Debounced write через 2 секунди після навчання, flush під час close. Під час commit застосувати pending deltas до свіжого disk snapshot під exclusive lock, далі temp file + atomic replace. Не зливати абсолютні snapshots додаванням.
- Lock: atomic mkdir поряд із файлом; retry асинхронно до 2 секунд. За timeout залишити pending deltas у пам'яті та попередити один раз; чужий lock автоматично не видаляти. Під час shutdown невдалий flush повідомити як незбережені зміни.
- Сортувати та обрізати до caps за decayed score, ties — lexical. Ігнорувати записи з невалідними типами/counts/timestamps; unsupported version або malformed JSON дають порожній personal layer і diagnostic, не crash.
- Додати `/ghost dictionary clear`: очистити personal state та pending deltas поточного процесу під тим самим lock. У документації пояснити, що інші відкриті Pi можуть згодом додати власні pending observations.

## 4. Задачі реалізації — tests first

### Task 1: Common asset, токенізація, index і ranking

**Files:** створити `src/dictionary/common-en.json`, `src/dictionary/PROVENANCE.md`, `src/dictionary/lexicon.ts`, `src/dictionary/ranking.ts`, `test/dictionary.test.ts`; змінити `THIRD_PARTY_NOTICES.md`, додати відповідну ліцензію в `licenses/`.

**Interfaces:** `WordStats { word: string; commonFrequency: number; promptCount: number; updatedAt: number }`; `PrefixStats { prefix: string; word: string; acceptCount: number; updatedAt: number }`; `DictionaryIndex.lookup(prefix: string, now: number): Suggestion | undefined`; `learnPrompt(text: string, now: number): void`; `accept(prefix: string, suffix: string, now: number): void`.

- [x] Зафіксувати version/revision і SHA256 джерела common frequencies. Кандидат — [wordfreq](https://github.com/rspeer/wordfreq), що надає частоти різними мовами. Перед копіюванням перевірити LICENSE та NOTICE саме даних; зафіксувати атрибуцію й умови derived asset. Python не стає runtime-залежністю. Остаточне джерело даних — відкритий пункт до цього кроку.
- [x] Написати failing tests: `becau→se`, ambiguous prefix abstains, prefix length 2 abstains, exact word abstains, single rare personal word abstains, два submitted prompts додають eligibility; прийняття для одного prefix не підсилює інший.
- [x] Додати tests для NFC, обох апострофів, Title/UPPER/mixed case, code fences/paths/paste exclusions, decay через 30 днів = половина, stable ties, caps та кандидата наприкінці великого prefix range.
- [x] Запустити `node --experimental-strip-types --test test/dictionary.test.ts`; переконатися, що тести падають через відсутню реалізацію.
- [x] Реалізувати index, фільтри навчання та ranking за розділом 3. Reuse наявних prose helpers; не послаблювати query gate.
- [x] Повторити targeted tests та `npm run check`: PASS.

### Task 2: Персональний store та навчання

**Files:** створити `src/dictionary/store.ts`, `test/dictionary-store.test.ts`; змінити `src/paths.ts`.

**Interfaces:** `PersonalDictionaryStore.load(): Promise<void>`; `recordPrompt(text: string): void`; `recordAcceptance(prefix: string, suffix: string): void`; `persist(): Promise<void>`; `clear(): Promise<void>`; `close(): Promise<void>`. Store володіє index та pending deltas; FS root і clock ін'єктуються.

- [x] Написати failing tests у temporary directories: restart відновлює ranking; observation під час load не губиться; слово повторене 10 разів в одному prompt дає +1; acceptance не дублюється.
- [x] Додати tests: corrupt JSON, unsupported version, write failure, lock timeout, два незалежні store instances із interleaved writes, clear, close flush і відсутність пізніх записів після close.
- [x] Запустити `node --experimental-strip-types --test test/dictionary-store.test.ts`, підтвердити RED.
- [x] Реалізувати bounded store, delta merge під lock, debounce/flush та diagnostics відповідно до розділу 3.
- [x] Повторити targeted tests та `npm run check`: PASS. Підтвердити atomic replace на Windows, не вважати POSIX-only перевірку достатньою.

### Task 3: HybridPredictor і швидкий шлях controller

**Files:** створити `src/completion/hybrid-predictor.ts`, `test/hybrid-predictor.test.ts`; змінити `src/completion/types.ts`, `src/completion/controller.ts`, `test/controller.test.ts`.

**Interfaces:** `HybridPredictor implements Predictor`, constructor приймає model `Predictor`, dictionary store/index та diagnostic callback. Є optional fastComplete з розділу 3; публічний native ABI не змінюється.

- [x] Написати failing tests зі spies/deferred promises: dictionary hit → model.complete calls = 0; miss/ambiguity → calls = 1; dictionary hit під час незавершеного model.ready працює; model failure залишає dictionary доступним.
- [x] Додати controller tests: активний LLM для `he`, новий dictionary hit для `becau` одразу видимий до resolve LLM; старий LLM не перекриває його; miss після hit не відновлює obsolete queued work.
- [x] Додати tests для Escape, acceptance once, projection, reset/session/dispose із fast hit та late LLM success/error; dictionary feedback не чекає engine readiness.
- [x] Запустити `node --experimental-strip-types --test test/hybrid-predictor.test.ts test/controller.test.ts`, підтвердити RED.
- [x] Реалізувати обгортку та fast path, лишивши нинішній bounded model queue. Обмежити lifetime request bookkeeping; не робити кожне натискання необмеженим паралельним inference.
- [x] Повторити targeted tests та `npm run check`: PASS.

### Task 4: Session wiring, оцінка якості та пакування

**Files:** змінити `src/pi-ghost-autocomplete.ts`, `test/host-wiring.test.ts`, `test/package.test.ts`, `README.md`, `docs/verification.md`; створити `test/fixtures/dictionary-evaluation.json`, `scripts/evaluate-dictionary.mjs`.

**Interfaces:** extension створює один HybridPredictor на editor lease; `GhostServices` отримує injected dictionary factory для тестів; production factory використовує common asset і shared personal path.

- [x] Написати failing integration tests: session_start одразу запускає model prepare без prompt; dictionary готовий раніше моделі; dictionary failure → LLM; model failure → dictionary; off/retry/shutdown/editor replacement не оновлюють disposed UI та не втрачають pending flush без diagnostic.
- [x] Додати tests для `/ghost status`, `/ghost dictionary clear`, learning лише з interactive input, package asset inclusion і коректного load після встановлення tarball.
- [x] Запустити `node --experimental-strip-types --test test/host-wiring.test.ts test/package.test.ts`, підтвердити RED; реалізувати wiring та docs; повторити до PASS.
- [x] Створити evaluation corpus щонайменше з 300 English prose word occurrences у реченнях; програвати prefixes від 2 до length−1. Розділити tuning/evaluation за реченнями; персональне навчання — лише з попередніх prompts. Окремо перевірити unfamiliar/ambiguous, Ukrainian personal words, capitalized words та code exclusions. Не використовувати приватні prompts без окремого запиту користувача.
- [x] Script звітує: precision серед dictionary hits, coverage, частку fallback, simulated saved keystrokes та p50/p95 lookup latency на 20k common +20k personal. Для latency 1000 warm-up і 10 000 queries; hardware/runtime записати. Model invocation saving перевірити spies; реальну загальну latency hybrid перевірити окремо зі справною моделлю.
- [x] Критерії випуску: dictionary precision >=95% на held-out English set; p95 lookup <=5 ms на цьому ПК; `becau` без inference; ambiguous fixture із fallback; нуль регресій lifecycle/editor tests. Це цілі, не поточні вимірювання. Coverage опублікувати, але не підвищувати її зниженням precision нижче порога.
- [x] Запустити `npm test`, `npm run check`, `git diff --check`, evaluation script і `npm pack --dry-run`; підтвердити PASS та включення asset/license. 
- [ ] Перед публікацією пройти наявний CI на підтримуваних платформах.
- [ ] Ручний TUI smoke: старт без prompt, dictionary до model ready, Tab/Right, Escape, інший prefix під час inference, restart із personal learning, clear, off/on. Окремо відзначити неперевірене.

## 5. Межі першої ітерації та handoff

Наступні ітерації: learned bigram context, Ukrainian common dictionary, typo correction, project vocabulary та learned ranker. Не включати їх у v1. Для code identifiers на кшталт camelCase діє чинний prose gate; це не IDE symbol completion.

Основні відкриті перевірки перед виконанням: provenance common asset; вплив запропонованих score/thresholds на held-out корпусі; latency на цьому ПК. Якщо confidence gate не дає потрібної точності, коригувати його на tuning split і перевіряти на новому held-out наборі.

План не є свідченням реалізації або проходження тестів. Наступний крок після погодження дизайну — Task 1 із RED → GREEN, далі задачі послідовно в цій сесії.

## Виконання 2026-10-28

Локальну реалізацію завершено. Повний Windows suite із native/model tests: 71/71 PASS, 0 skip; typecheck та package checks пройшли. Незалежне рев’ю виявило shutdown diagnostic race, відтворений і виправлений тестом. Результати synthetic evaluation і real-model smoke збережені в docs/evidence/dictionary-evaluation.json та docs/evidence/dictionary-real-model.json. Ручний human-operated TUI smoke і новий cross-platform CI перед release залишаються неперевіреними.
